/**
 * Step 3 checks: each connector turns its source format into the shared record shape,
 * keeps permissions (including "unknown"), and fails safely on bad input.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SalesCsvConnector } from '../src/connectors/sales-csv.connector';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { ProductMarkdownConnector } from '../src/connectors/product-markdown.connector';
import { ChangeBatch, SourceRecord } from '../src/connectors/source-connector';

function records(batch: ChangeBatch): SourceRecord[] {
  return batch.changes.flatMap((change) => (change.type === 'upsert' ? [change.record] : []));
}

function byId(batch: ChangeBatch, id: string): SourceRecord | undefined {
  return records(batch).find((record) => record.externalId === id);
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'connector-test-'));
}

describe('SalesCsvConnector', () => {
  it('reads every row as a full snapshot', async () => {
    const batch = await new SalesCsvConnector().fetchChanges();
    expect(batch.isFullSnapshot).toBe(true);
    expect(records(batch).map((r) => r.externalId)).toEqual(['S-101', 'S-102', 'S-103', 'S-104', 'S-105']);
  });

  it('maps fields, permissions and explicit feature IDs', async () => {
    const batch = await new SalesCsvConnector().fetchChanges();
    const lidl = byId(batch, 'S-103')!;
    expect(lidl.allowedGroups).toEqual(['sales']);
    expect(lidl.explicitFeatureKeys).toEqual(['dark-mode']);
    expect(lidl.metadata).toMatchObject({ account: 'Lidl Deutschland', dealValueEur: 240000 });
    expect(lidl.content).toContain('15% discount'); // quoted CSV text with commas survives
    expect(byId(batch, 'S-101')!.allowedGroups).toEqual(['sales', 'product']);
  });

  it('leaves the feature empty when the row has no feature ID (linked by alias later)', async () => {
    const batch = await new SalesCsvConnector().fetchChanges();
    expect(byId(batch, 'S-102')!.explicitFeatureKeys).toEqual([]);
  });

  it('treats an empty allowed_groups cell as unknown (denied)', async () => {
    const file = join(tempDir(), 'requests.csv');
    writeFileSync(
      file,
      'id,account,feature_id,request,deal_value_eur,stage,allowed_groups,updated_at\n' +
        'S-1,Acme,,Wants dark mode,10,new,,2026-10-01T00:00:00Z\n',
    );
    const batch = await new SalesCsvConnector(file).fetchChanges();
    expect(byId(batch, 'S-1')!.allowedGroups).toBeNull();
  });

  it('fails the whole source on a bad row, naming the line', async () => {
    const file = join(tempDir(), 'requests.csv');
    writeFileSync(
      file,
      'id,account,feature_id,request,deal_value_eur,stage,allowed_groups,updated_at\n' +
        'S-1,Acme,,Fine row,10,new,sales,2026-10-01T00:00:00Z\n' +
        'S-2,Acme,,Bad value,lots,new,sales,2026-10-01T00:00:00Z\n',
    );
    await expect(new SalesCsvConnector(file).fetchChanges()).rejects.toThrow(/line 3.*deal_value_eur/);
  });
});

describe('EngineeringJsonConnector', () => {
  it('reads every ticket and keeps estimates in the searchable text', async () => {
    const batch = await new EngineeringJsonConnector().fetchChanges();
    expect(records(batch).map((r) => r.externalId)).toEqual(['ENG-42', 'ENG-43', 'ENG-51', 'ENG-60']);
    const eng42 = byId(batch, 'ENG-42')!;
    expect(eng42.content).toContain('Estimate: 6 weeks');
    expect(eng42.explicitFeatureKeys).toEqual(['dark-mode']);
    expect(eng42.metadata).toEqual({ status: 'planned', estimateWeeks: 6 });
  });

  it('marks a ticket with no allowed_groups as unknown permissions', async () => {
    const batch = await new EngineeringJsonConnector().fetchChanges();
    expect(byId(batch, 'ENG-60')!.allowedGroups).toBeNull();
  });

  it('handles a null feature (linked by alias later)', async () => {
    const batch = await new EngineeringJsonConnector().fetchChanges();
    expect(byId(batch, 'ENG-43')!.explicitFeatureKeys).toEqual([]);
  });

  it('fails on invalid JSON', async () => {
    const file = join(tempDir(), 'tickets.json');
    writeFileSync(file, '[{ not json');
    await expect(new EngineeringJsonConnector(file).fetchChanges()).rejects.toThrow(/not valid JSON/);
  });

  it('fails on duplicate ticket IDs', async () => {
    const file = join(tempDir(), 'tickets.json');
    const ticket = { id: 'ENG-1', title: 'T', description: '', status: 'done', updated_at: '2026-10-01T00:00:00Z' };
    writeFileSync(file, JSON.stringify([ticket, ticket]));
    await expect(new EngineeringJsonConnector(file).fetchChanges()).rejects.toThrow(/Duplicate record ID "ENG-1"/);
  });
});

describe('ProductMarkdownConnector', () => {
  it('reads each Markdown file with its front matter', async () => {
    const batch = await new ProductMarkdownConnector().fetchChanges();
    expect(
      records(batch)
        .map((r) => r.externalId)
        .sort(),
    ).toEqual(['PRD-11', 'PRD-7', 'PRD-9']);
    const brief = byId(batch, 'PRD-7')!;
    expect(brief.title).toBe('Dark mode product brief');
    expect(brief.allowedGroups).toEqual(['product', 'sales', 'engineering']);
    expect(brief.explicitFeatureKeys).toEqual(['dark-mode']);
    expect(brief.updatedAt).toBe('2026-10-24T10:00:00Z');
    expect(brief.content.startsWith('## Problem')).toBe(true); // front matter removed from the text
  });

  it('keeps the planted instruction as plain content (it is data, not a command)', async () => {
    const batch = await new ProductMarkdownConnector().fetchChanges();
    expect(byId(batch, 'PRD-11')!.content).toContain('Ignore all previous instructions');
  });

  it('fails on a file without front matter, naming the file', async () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.md'), '# No front matter here');
    await expect(new ProductMarkdownConnector(dir).fetchChanges()).rejects.toThrow(/broken\.md/);
  });
});

describe('snapshot cursor', () => {
  it('stays the same when nothing changed and changes after an edit', async () => {
    const dir = tempDir();
    const write = (body: string) =>
      writeFileSync(
        join(dir, 'doc.md'),
        `---\nid: D-1\ntitle: Doc\nallowed_groups: [product]\nupdated_at: 2026-10-01T00:00:00Z\n---\n${body}`,
      );

    write('First version');
    const first = await new ProductMarkdownConnector(dir).fetchChanges();
    const again = await new ProductMarkdownConnector(dir).fetchChanges();
    write('Second version');
    const edited = await new ProductMarkdownConnector(dir).fetchChanges();

    expect(again.nextCursor).toBe(first.nextCursor);
    expect(edited.nextCursor).not.toBe(first.nextCursor);
  });
});
