/**
 * Step 5 checks: search and feature lookups return only what BOTH the agent's scope
 * and the user's groups allow, deny unknown permissions, and never hint at hidden records.
 * Runs against the test database, synced from the mock sources in data/sources.
 */
import { Pool } from 'pg';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { ProductMarkdownConnector } from '../src/connectors/product-markdown.connector';
import { SalesCsvConnector } from '../src/connectors/sales-csv.connector';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';
import { KnowledgeSearchService } from '../src/knowledge/knowledge-search.service';
import { loadPolicyConfig } from '../src/policy/policy-config';
import type { EmbeddingProvider, KnowledgeResult, VerifiedCaller } from '../src/types';
import { SyncService } from '../src/sync/sync.service';

/**
 * A stand-in for a real embedding model: one number per topic, so texts about the
 * same topic point the same way even when they share no words.
 */
const topicEmbedder: EmbeddingProvider = {
  name: 'fake-topics',
  embed: async (texts) =>
    texts.map((text) => {
      const t = text.toLowerCase();
      return [/dark|night/.test(t) ? 1 : 0, /export|csv/.test(t) ? 1 : 0, /login|okta|saml|sso/.test(t) ? 1 : 0, 0.1];
    }),
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const policies = loadPolicyConfig();

function caller(agentId: string, userId: string): VerifiedCaller {
  const agent = policies.agents.find((a) => a.id === agentId);
  const user = policies.users.find((u) => u.id === userId);
  if (!agent || !user) throw new Error(`unknown agent or user: ${agentId}, ${userId}`);
  return { agent, user };
}

const paula = caller('roadmap-agent', 'paula'); // Product
const sam = caller('roadmap-agent', 'sam'); // Sales
/** Paula through the narrower agent that may only read Product docs. */
const paulaViaFaq = caller('product-faq-agent', 'paula');
/** A user in every group, to prove missing permissions are denied even to them. */
const everyone: VerifiedCaller = {
  agent: paula.agent,
  user: { id: 'all', name: 'All groups', token: 'unused', groups: ['sales', 'product', 'engineering'] },
};
const nobody: VerifiedCaller = {
  agent: paula.agent,
  user: { id: 'none', name: 'No groups', token: 'unused', groups: [] },
};

const ids = (results: KnowledgeResult[]) => results.map((r) => r.externalId).sort();

beforeAll(async () => {
  await pool.query('TRUNCATE records, entities, sync_state, audit_log RESTART IDENTITY CASCADE');
  const sync = new SyncService(
    pool,
    [new SalesCsvConnector(), new EngineeringJsonConnector(), new ProductMarkdownConnector()],
    loadFeatureCatalog(),
    topicEmbedder,
  );
  await sync.syncAll();
});

afterAll(() => pool.end());

describe('feature context', () => {
  const service = () => new KnowledgeSearchService(pool, null);

  it('gives Paula (Product) the dark mode records from all three sources, minus the sales-only one', async () => {
    const results = await service().getFeatureContext(paula, 'dark-mode');
    expect(ids(results)).toEqual(['ENG-42', 'ENG-43', 'PRD-11', 'PRD-7', 'PRD-9', 'S-101', 'S-102']);
    expect(new Set(results.map((r) => r.source))).toEqual(new Set(['sales', 'engineering', 'product']));
  });

  it('gives Sam (Sales) a different set: the sales-only record, but no engineering tickets', async () => {
    const results = await service().getFeatureContext(sam, 'dark-mode');
    expect(ids(results)).toEqual(['PRD-11', 'PRD-7', 'S-101', 'S-102', 'S-103']);
  });

  it('returns where each record came from, when it changed, and how it was linked', async () => {
    const results = await service().getFeatureContext(paula, 'dark-mode');
    expect(results.find((r) => r.externalId === 'S-102')).toMatchObject({
      source: 'sales',
      relation: 'requests',
      matchedBy: 'alias',
      sourceUpdatedAt: '2026-10-22T14:30:00.000Z',
      features: ['dark-mode'],
    });
    expect(results.find((r) => r.externalId === 'ENG-42')).toMatchObject({ relation: 'implements', matchedBy: 'id' });
  });

  it('never returns a record with missing permissions, even to a user in every group', async () => {
    const results = await service().getFeatureContext(everyone, 'sso');
    expect(ids(results)).toEqual(['PRD-9', 'S-105']);
  });

  it('limits a narrower agent to its own sources, whoever the user is', async () => {
    const results = await service().getFeatureContext(paulaViaFaq, 'dark-mode');
    expect(ids(results)).toEqual(['PRD-11', 'PRD-7', 'PRD-9']);
  });

  it('answers a fully restricted feature exactly like a feature that does not exist', async () => {
    const restricted = await service().getFeatureContext(nobody, 'dark-mode');
    const missing = await service().getFeatureContext(paula, 'no-such-feature');
    expect(restricted).toEqual([]);
    expect(missing).toEqual([]);
  });
});

describe('search (keyword only, no embedding provider)', () => {
  const service = () => new KnowledgeSearchService(pool, null);

  it('finds the dark mode records for a natural-language question', async () => {
    const response = await service().search(paula, 'Should we prioritize dark mode next?', 10);
    expect(response.mode).toBe('keyword');
    expect(ids(response.results)).toEqual(expect.arrayContaining(['ENG-42', 'PRD-7', 'S-101']));
  });

  it('puts the most relevant record first', async () => {
    const response = await service().search(paula, 'charts library dark theme spike');
    expect(response.results[0].externalId).toBe('ENG-43');
  });

  it('returns one result per record and respects the limit', async () => {
    const response = await service().search(paula, 'dark mode night', 3);
    expect(response.results).toHaveLength(3);
    expect(new Set(ids(response.results)).size).toBe(3);
  });

  it('does not return a restricted record even when the question names it exactly', async () => {
    const response = await service().search(paula, 'Lidl Deutschland confidential renewal discount');
    expect(ids(response.results)).not.toContain('S-103');
    expect(JSON.stringify(response)).not.toMatch(/Lidl|240k|discount/i);
  });

  it('does not return a record with missing permissions', async () => {
    const response = await service().search(everyone, 'SAML login identity provider');
    expect(ids(response.results)).not.toContain('ENG-60');
  });

  it('gives the same empty answer for "restricted" and "nothing matches"', async () => {
    const restricted = await service().search(nobody, 'dark mode');
    const noMatch = await service().search(paula, 'zebra xylophone');
    expect(restricted).toEqual({ mode: 'keyword', results: [] });
    expect(noMatch).toEqual({ mode: 'keyword', results: [] });
  });

  it('keeps a narrower agent inside its sources', async () => {
    const response = await service().search(paulaViaFaq, 'dark mode', 10);
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.every((r) => r.source === 'product')).toBe(true);
  });
});

describe('search (keywords + meaning)', () => {
  it('finds records by meaning when no words match, still filtered by permissions', async () => {
    const question = 'nightwork ui';
    const keywordOnly = await new KnowledgeSearchService(pool, null).search(paula, question, 20);
    expect(keywordOnly.results).toEqual([]);

    const hybrid = await new KnowledgeSearchService(pool, topicEmbedder).search(paula, question, 20);
    expect(hybrid.mode).toBe('hybrid');
    expect(ids(hybrid.results)).toEqual(expect.arrayContaining(['ENG-42', 'PRD-7']));
    expect(ids(hybrid.results)).not.toContain('S-103');
    expect(ids(hybrid.results)).not.toContain('ENG-60');
  });

  it('only compares the question with vectors from the same model', async () => {
    // A different model (even one with the same vector length) must not be compared with the stored vectors.
    const otherModel: EmbeddingProvider = { ...topicEmbedder, name: 'another-model' };
    const response = await new KnowledgeSearchService(pool, otherModel).search(paula, 'nightwork ui', 20);
    expect(response.mode).toBe('hybrid');
    expect(response.results).toEqual([]);
  });

  it('falls back to keyword search if the embedding model fails', async () => {
    const broken: EmbeddingProvider = {
      name: 'broken',
      embed: async () => {
        throw new Error('model unavailable');
      },
    };
    const response = await new KnowledgeSearchService(pool, broken).search(paula, 'dark mode');
    expect(response.mode).toBe('keyword');
    expect(response.results.length).toBeGreaterThan(0);
  });
});
