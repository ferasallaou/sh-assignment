import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { AgentRun } from '../types';

const caseSchema = z.object({
  id: z.string().min(1),
  user: z.string().min(1),
  question: z.string().min(1),
  must_cite_any: z.array(z.string()).default([]),
  must_not_say: z.array(z.string()).default([]),
});

export type AnswerCase = z.infer<typeof caseSchema>;

export interface AnswerCaseResult {
  id: string;
  passed: boolean;
  problems: string[];
  cited: string[];
}

export const DEFAULT_ANSWER_SET = join(__dirname, '..', '..', 'data', 'eval', 'answers.yaml');

export function loadAnswerCases(path: string = DEFAULT_ANSWER_SET): AnswerCase[] {
  return z.object({ cases: z.array(caseSchema) }).parse(parse(readFileSync(path, 'utf8'))).cases;
}

/** Scores one agent run against its case. Checks evidence, not wording. */
export function scoreAnswer(c: AnswerCase, run: AgentRun): AnswerCaseResult {
  const problems: string[] = [];
  const cited = run.citations.map((citation) => citation.externalId);

  if (c.must_cite_any.length > 0 && !c.must_cite_any.some((id) => cited.includes(id))) {
    problems.push(`cites none of ${c.must_cite_any.join(', ')}`);
  }
  const lower = run.answer.toLowerCase();
  for (const phrase of c.must_not_say) {
    if (lower.includes(phrase.toLowerCase())) problems.push(`mentions "${phrase}"`);
  }
  if (run.unverifiedCitations.length > 0) {
    problems.push(`cites sources no tool returned: ${run.unverifiedCitations.join(', ')}`);
  }
  return { id: c.id, passed: problems.length === 0, problems, cited };
}
