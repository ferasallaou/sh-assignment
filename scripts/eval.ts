/**
 * Runs the small evaluation sets against the synced demo database.
 *
 *   npm run eval                 retrieval: keyword search, plus keyword + meaning if OPENROUTER_API_KEY is set
 *   npm run eval -- --answers    also asks the real agent the questions in data/eval/answers.yaml
 *
 * Exits with 1 if any case fails. Any permission leak is a failure whatever the scores.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { McpToolClient } from '../src/agent/mcp-tool-client';
import { RoadmapAgent } from '../src/agent/roadmap-agent';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';
import { DB_POOL } from '../src/database/database.module';
import { loadAnswerCases, scoreAnswer } from '../src/eval/answer-eval';
import { loadRetrievalCases, RetrievalReport, runRetrievalEval } from '../src/eval/retrieval-eval';
import { KnowledgeSearchService } from '../src/knowledge/knowledge-search.service';
import { McpService } from '../src/mcp/mcp.service';
import { loadPolicyConfig } from '../src/policy/policy-config';
import { EMBEDDING_PROVIDER } from '../src/providers/embedding-provider';
import { LLM_PROVIDER } from '../src/providers/llm-provider';
import type { EmbeddingProvider, LlmProvider } from '../src/types';

function printRetrieval(report: RetrievalReport): void {
  console.log(`\nRetrieval (${report.mode})`);
  console.table(
    report.results.map((r) => ({
      case: r.id,
      result: r.skipped ? 'skipped (needs meaning)' : r.passed ? 'pass' : 'FAIL',
      missing: r.missing.join(' '),
      leaked: r.leaked.join(' '),
      returned: r.returned.join(' '),
    })),
  );
  console.log(
    `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped · ` +
      `recall ${(report.recall * 100).toFixed(0)}% · permission leaks: ${report.leaks}`,
  );
}

async function main(): Promise<void> {
  const withAnswers = process.argv.includes('--answers');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let failed = false;
  try {
    const pool = app.get<Pool>(DB_POOL);
    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM records');
    if (Number(rows[0].count) === 0) throw new Error('The database is empty. Run "npm run sync" first.');

    const policies = loadPolicyConfig();
    const cases = loadRetrievalCases();
    const embedder = app.get<EmbeddingProvider | null>(EMBEDDING_PROVIDER);

    const keyword = await runRetrievalEval(new KnowledgeSearchService(pool, null), policies, cases);
    printRetrieval(keyword);
    failed ||= keyword.failed > 0;

    if (embedder) {
      const hybrid = await runRetrievalEval(new KnowledgeSearchService(pool, embedder), policies, cases);
      printRetrieval(hybrid);
      failed ||= hybrid.failed > 0;
    } else {
      console.log('\n(No OPENROUTER_API_KEY: meaning search not evaluated.)');
    }

    if (withAnswers) {
      const llm = app.get<LlmProvider | null>(LLM_PROVIDER);
      if (!llm) throw new Error('--answers needs OPENROUTER_API_KEY');
      const mcp = app.get(McpService);
      const url = await mcp.listen(0);
      try {
        console.log(`\nAnswers (${llm.name}, via the MCP service)`);
        const results = [];
        for (const c of loadAnswerCases()) {
          const user = policies.users.find((u) => u.id === c.user);
          if (!user) throw new Error(`${c.id}: unknown user ${c.user}`);
          const tools = await McpToolClient.connect(url, loadConfig().AGENT_KEY, user.token);
          try {
            const run = await new RoadmapAgent(llm, tools).ask(c.question);
            results.push(scoreAnswer(c, run));
          } finally {
            await tools.close();
          }
        }
        console.table(
          results.map((r) => ({
            case: r.id,
            result: r.passed ? 'pass' : 'FAIL',
            cited: r.cited.join(' '),
            problems: r.problems.join('; '),
          })),
        );
        failed ||= results.some((r) => !r.passed);
      } finally {
        await mcp.close();
      }
    }
  } finally {
    await app.close();
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✖ ${(error as Error).message}`);
  process.exit(1);
});
