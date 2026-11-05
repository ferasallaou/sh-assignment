import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import type { PolicyConfig } from '../types';

const caseSchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  user: z.string().min(1),
  query: z.string().min(1),
  expect: z.array(z.string()).default([]),
  forbid: z.array(z.string()).default([]),
  k: z.number().int().min(1).max(10).default(5),
  needs_meaning: z.boolean().default(false),
});

export type RetrievalCase = z.infer<typeof caseSchema>;

export interface RetrievalCaseResult {
  id: string;
  mode: 'hybrid' | 'keyword';
  returned: string[];
  /** Expected IDs that were not in the top k. */
  missing: string[];
  /** Forbidden IDs that came back: a permission failure. */
  leaked: string[];
  /** Skipped: needs meaning search, but this run is keyword-only. */
  skipped: boolean;
  passed: boolean;
}

export interface RetrievalReport {
  mode: 'hybrid' | 'keyword';
  results: RetrievalCaseResult[];
  passed: number;
  failed: number;
  skipped: number;
  /** Must always be 0. Any leak fails the eval whatever the relevance score. */
  leaks: number;
  /** Share of expected IDs found in the top k, over the cases that ran. */
  recall: number;
}

export const DEFAULT_RETRIEVAL_SET = join(__dirname, '..', '..', 'data', 'eval', 'retrieval.yaml');

export function loadRetrievalCases(path: string = DEFAULT_RETRIEVAL_SET): RetrievalCase[] {
  return z.object({ cases: z.array(caseSchema) }).parse(parse(readFileSync(path, 'utf8'))).cases;
}

/** Runs every case through the permission-aware search and scores it. */
export async function runRetrievalEval(
  search: KnowledgeSearchService,
  policies: PolicyConfig,
  cases: RetrievalCase[],
): Promise<RetrievalReport> {
  const results: RetrievalCaseResult[] = [];
  let expectedTotal = 0;
  let expectedFound = 0;
  let mode: 'hybrid' | 'keyword' = 'keyword';

  for (const c of cases) {
    const agent = policies.agents.find((a) => a.id === c.agent);
    const user = policies.users.find((u) => u.id === c.user);
    if (!agent || !user) throw new Error(`${c.id}: unknown agent or user (${c.agent}, ${c.user})`);

    const response = await search.search({ agent, user }, c.query, c.k);
    mode = response.mode;
    const returned = response.results.map((r) => r.externalId);
    const leaked = c.forbid.filter((id) => returned.includes(id));
    const skipped = c.needs_meaning && response.mode === 'keyword';
    const missing = skipped ? [] : c.expect.filter((id) => !returned.includes(id));
    if (!skipped) {
      expectedTotal += c.expect.length;
      expectedFound += c.expect.length - missing.length;
    }
    results.push({
      id: c.id,
      mode: response.mode,
      returned,
      missing,
      leaked,
      skipped,
      passed: leaked.length === 0 && missing.length === 0,
    });
  }

  return {
    mode,
    results,
    passed: results.filter((r) => r.passed && !r.skipped).length,
    failed: results.filter((r) => !r.passed).length,
    skipped: results.filter((r) => r.skipped && r.passed).length,
    leaks: results.reduce((sum, r) => sum + r.leaked.length, 0),
    recall: expectedTotal === 0 ? 1 : expectedFound / expectedTotal,
  };
}
