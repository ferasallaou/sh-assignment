/**
 * Step 4 checks: sync adds, edits and deletes records, rebuilds chunks and links,
 * keeps permissions, and fails safely. Runs against the test database,
 * on temporary copies of the mock sources so files can be edited freely.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { SalesCsvConnector } from '../src/connectors/sales-csv.connector';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { ProductMarkdownConnector } from '../src/connectors/product-markdown.connector';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';
import type { EmbeddingProvider } from '../src/providers/embedding-provider';
import { SyncService } from '../src/sync/sync.service';

/** A stand-in for the real model: same text always gives the same small vector. */
const fakeEmbedder: EmbeddingProvider = {
  name: 'fake',
  embed: async (texts) => texts.map((text) => [text.length % 7, text.length % 11, 1]),
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let dir: string;
let files: { sales: string; engineering: string; product: string };

function syncService(embedder: EmbeddingProvider | null = fakeEmbedder): SyncService {
  return new SyncService(
    pool,
    [
      new SalesCsvConnector(files.sales),
      new EngineeringJsonConnector(files.engineering),
      new ProductMarkdownConnector(files.product),
    ],
    loadFeatureCatalog(),
    embedder,
  );
}

async function recordIds(source: string): Promise<string[]> {
  const { rows } = await pool.query<{ external_id: string }>(
    'SELECT external_id FROM records WHERE source = $1 ORDER BY external_id',
    [source],
  );
  return rows.map((row) => row.external_id);
}

async function linksOf(externalId: string): Promise<string[]> {
  const { rows } = await pool.query<{ link: string }>(
    `SELECT e.key || ':' || l.relation || ':' || l.matched_by AS link
     FROM links l JOIN records r ON r.id = l.record_id JOIN entities e ON e.id = l.entity_id
     WHERE r.external_id = $1 ORDER BY link`,
    [externalId],
  );
  return rows.map((row) => row.link);
}

beforeEach(async () => {
  await pool.query('TRUNCATE records, entities, sync_state, audit_log RESTART IDENTITY CASCADE');
  dir = mkdtempSync(join(tmpdir(), 'sync-test-'));
  cpSync(join(__dirname, '..', 'data', 'sources'), dir, { recursive: true });
  files = {
    sales: join(dir, 'sales', 'feature_requests.csv'),
    engineering: join(dir, 'engineering', 'tickets.json'),
    product: join(dir, 'product'),
  };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));
afterAll(() => pool.end());

describe('first sync', () => {
  it('adds every record from all three sources', async () => {
    const report = await syncService().syncAll();
    expect(report.sources.map((s) => [s.source, s.status, s.added])).toEqual([
      ['sales', 'synced', 5],
      ['engineering', 'synced', 4],
      ['product', 'synced', 3],
    ]);
    expect(await recordIds('engineering')).toEqual(['ENG-42', 'ENG-43', 'ENG-51', 'ENG-60']);
  });

  it('creates chunks and embeds them all', async () => {
    const report = await syncService().syncAll();
    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM chunks');
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(12);
    expect(report.chunksEmbedded).toBe(Number(rows[0].count));
    expect(report.chunksWaitingForEmbedding).toBe(0);
  });

  it('links records to features by ID and by alias', async () => {
    await syncService().syncAll();
    expect(await linksOf('S-101')).toEqual(['dark-mode:requests:id']);
    expect(await linksOf('S-102')).toEqual(['dark-mode:requests:alias']); // "night mode"
    expect(await linksOf('S-105')).toEqual(['sso:requests:alias']); // "Okta login"
    expect(await linksOf('ENG-43')).toEqual(['dark-mode:implements:alias']); // "dark theme"
    expect(await linksOf('PRD-9')).toEqual([
      'bulk-export:describes:alias',
      'dark-mode:describes:alias',
      'sso:describes:alias',
    ]);
  });

  it('stores missing permissions as unknown (NULL) and warns about it', async () => {
    const report = await syncService().syncAll();
    const { rows } = await pool.query('SELECT allowed_groups FROM records WHERE external_id = $1', ['ENG-60']);
    expect(rows[0].allowed_groups).toBeNull();
    const engineering = report.sources.find((s) => s.source === 'engineering')!;
    expect(engineering.warnings).toContain('ENG-60: no permissions in source, denied to everyone');
  });
});

describe('later syncs', () => {
  it('skips sources whose snapshot did not change', async () => {
    await syncService().syncAll();
    const report = await syncService().syncAll();
    expect(report.sources.map((s) => s.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
  });

  it('applies an edit: new text is searchable, old text is gone', async () => {
    await syncService().syncAll();
    const tickets = JSON.parse(readFileSync(files.engineering, 'utf8'));
    tickets[0].description = 'Estimate cut to 3 weeks after reusing the new design tokens.';
    tickets[0].estimate_weeks = 3;
    writeFileSync(files.engineering, JSON.stringify(tickets));

    const report = await syncService().syncAll();
    const engineering = report.sources.find((s) => s.source === 'engineering')!;
    expect([engineering.updated, engineering.unchanged]).toEqual([1, 3]);

    const { rows } = await pool.query<{ content: string }>(
      `SELECT c.content FROM chunks c JOIN records r ON r.id = c.record_id WHERE r.external_id = 'ENG-42'`,
    );
    expect(rows.map((row) => row.content).join(' ')).toContain('3 weeks');
    expect(rows.map((row) => row.content).join(' ')).not.toContain('6 weeks');
  });

  it('applies a permission-only change without re-chunking', async () => {
    await syncService().syncAll();
    const chunkIdsBefore = await pool.query(
      `SELECT c.id FROM chunks c JOIN records r ON r.id = c.record_id WHERE r.external_id = 'S-101'`,
    );
    writeFileSync(files.sales, readFileSync(files.sales, 'utf8').replace(/(S-101,.*,)sales;product,/, '$1sales,'));

    const report = await syncService().syncAll();
    expect(report.sources.find((s) => s.source === 'sales')!.updatedWithoutRechunk).toBe(1);

    const record = await pool.query(`SELECT allowed_groups FROM records WHERE external_id = 'S-101'`);
    expect(record.rows[0].allowed_groups).toEqual(['sales']);
    const chunkIdsAfter = await pool.query(
      `SELECT c.id FROM chunks c JOIN records r ON r.id = c.record_id WHERE r.external_id = 'S-101'`,
    );
    expect(chunkIdsAfter.rows).toEqual(chunkIdsBefore.rows);
  });

  it('applies a deletion: the record, its chunks and its links are gone', async () => {
    await syncService().syncAll();
    const tickets = JSON.parse(readFileSync(files.engineering, 'utf8'));
    writeFileSync(files.engineering, JSON.stringify(tickets.filter((t: { id: string }) => t.id !== 'ENG-42')));

    const report = await syncService().syncAll();
    expect(report.sources.find((s) => s.source === 'engineering')!.deleted).toBe(1);
    expect(await recordIds('engineering')).toEqual(['ENG-43', 'ENG-51', 'ENG-60']);

    const leftovers = await pool.query(
      `SELECT (SELECT count(*) FROM chunks c LEFT JOIN records r ON r.id = c.record_id WHERE r.id IS NULL) AS chunks,
              (SELECT count(*) FROM links l LEFT JOIN records r ON r.id = l.record_id WHERE r.id IS NULL) AS links`,
    );
    expect(leftovers.rows[0]).toEqual({ chunks: '0', links: '0' });
  });

  it('applies a deleted Markdown file', async () => {
    await syncService().syncAll();
    rmSync(join(files.product, 'q1-roadmap-draft.md'));
    await syncService().syncAll();
    expect(await recordIds('product')).toEqual(['PRD-11', 'PRD-7']);
  });
});

describe('failing safely', () => {
  it('refuses to wipe a source when its export comes back empty', async () => {
    await syncService().syncAll();
    writeFileSync(files.sales, 'id,account,feature_id,request,deal_value_eur,stage,allowed_groups,updated_at\n');

    const report = await syncService().syncAll();
    const sales = report.sources.find((s) => s.source === 'sales')!;
    expect(sales.status).toBe('failed');
    expect(sales.error).toMatch(/refusing to delete them all/);
    expect(await recordIds('sales')).toHaveLength(5);
  });

  it('keeps syncing the other sources when one source is broken', async () => {
    writeFileSync(files.engineering, '[{ broken');
    const report = await syncService().syncAll();
    expect(report.sources.map((s) => s.status)).toEqual(['synced', 'failed', 'synced']);
    expect(await recordIds('engineering')).toEqual([]);
    expect(await recordIds('sales')).toHaveLength(5);
  });

  it('retries a failed source on the next run (cursor was not saved)', async () => {
    const original = readFileSync(files.engineering, 'utf8');
    writeFileSync(files.engineering, '[{ broken');
    await syncService().syncAll();
    writeFileSync(files.engineering, original);

    const report = await syncService().syncAll();
    expect(report.sources.find((s) => s.source === 'engineering')!.added).toBe(4);
  });

  it('leaves chunks waiting when no embedding provider is configured, then fills them later', async () => {
    const first = await syncService(null).syncAll();
    expect(first.chunksEmbedded).toBe(0);
    expect(first.chunksWaitingForEmbedding).toBeGreaterThan(0);

    const second = await syncService(fakeEmbedder).syncAll();
    expect(second.chunksEmbedded).toBe(first.chunksWaitingForEmbedding);
    expect(second.chunksWaitingForEmbedding).toBe(0);
  });
});
