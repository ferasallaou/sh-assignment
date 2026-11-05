/**
 * Step 9 check: the retrieval test set (data/eval/retrieval.yaml) passes with keyword search,
 * with zero permission leaks. Runs in CI with no model key; `npm run eval` also scores meaning search.
 */
import { Pool } from 'pg';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { HrMarkdownConnector } from '../src/connectors/hr-markdown.connector';
import { ProductMarkdownConnector } from '../src/connectors/product-markdown.connector';
import { SalesCsvConnector } from '../src/connectors/sales-csv.connector';
import { loadAnswerCases, scoreAnswer } from '../src/eval/answer-eval';
import { loadRetrievalCases, runRetrievalEval } from '../src/eval/retrieval-eval';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';
import { KnowledgeSearchService } from '../src/knowledge/knowledge-search.service';
import { loadPolicyConfig } from '../src/policy/policy-config';
import { SyncService } from '../src/sync/sync.service';
import type { AgentRun } from '../src/types';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  await pool.query('TRUNCATE records, entities, sync_state, audit_log RESTART IDENTITY CASCADE');
  await new SyncService(
    pool,
    [
      new SalesCsvConnector(),
      new EngineeringJsonConnector(),
      new ProductMarkdownConnector(),
      new HrMarkdownConnector(),
    ],
    loadFeatureCatalog(),
    null,
  ).syncAll();
});

afterAll(() => pool.end());

describe('retrieval test set (keyword search)', () => {
  it('passes every case that keyword search can answer, with no permission leaks', async () => {
    const report = await runRetrievalEval(
      new KnowledgeSearchService(pool, null),
      loadPolicyConfig(),
      loadRetrievalCases(),
    );
    const failures = report.results.filter((r) => !r.passed);
    expect(failures).toEqual([]);
    expect(report.leaks).toBe(0);
    expect(report.recall).toBe(1);
    expect(report.skipped).toBe(1); // the one case that needs meaning search
  });

  it('counts a forbidden record in the results as a leak and a failure', async () => {
    const [darkMode] = loadRetrievalCases();
    const leaky = { ...darkMode, id: 'leak-probe', forbid: ['PRD-7'] }; // PRD-7 is visible to Paula
    const report = await runRetrievalEval(new KnowledgeSearchService(pool, null), loadPolicyConfig(), [leaky]);
    expect(report.leaks).toBe(1);
    expect(report.failed).toBe(1);
  });
});

describe('answer scoring', () => {
  const run = (answer: string, cited: string[], unverified: string[] = []): AgentRun => ({
    answer,
    citations: cited.map((externalId) => ({ externalId, source: 's', title: 't', sourceUpdatedAt: 'd' })),
    unverifiedCitations: unverified,
    toolCalls: 1,
    stoppedByLimit: false,
  });
  const [product] = loadAnswerCases();

  it('passes an answer that cites expected evidence and mentions nothing hidden', () => {
    expect(scoreAnswer(product, run('Do it [ENG-42].', ['ENG-42'])).passed).toBe(true);
  });

  it('fails an answer that mentions a hidden record, cites nothing expected, or invents a source', () => {
    const result = scoreAnswer(product, run('Lidl wants it [S-101] [ENG-999].', ['S-101'], ['ENG-999']));
    expect(result.passed).toBe(false);
    expect(result.problems).toEqual([
      'cites none of ENG-42, PRD-7',
      'mentions "Lidl"',
      'cites sources no tool returned: ENG-999',
    ]);
  });
});
