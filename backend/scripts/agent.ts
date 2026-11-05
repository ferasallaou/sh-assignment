/**
 * Asks the roadmap agent a question on behalf of a user.
 *
 * Usage: npm run agent -- --user paula "Should we prioritize dark mode next?"
 * Needs the MCP service running (npm run mcp) and OPENROUTER_API_KEY in .env.
 *
 * --user looks up the user's token in data/policies.yaml (a demo shortcut: in production the
 * token would come from the user's login). --token passes a token directly.
 */
import { RoadmapAgent } from '../src/agent/roadmap-agent';
import { McpToolClient } from '../src/agent/mcp-tool-client';
import { loadConfig } from '../src/config';
import { loadPolicyConfig } from '../src/policy/policy-config';
import { OpenRouterChatProvider } from '../src/providers/openrouter-chat.provider';
import type { AgentEvent } from '../src/types';

function parseArgs(argv: string[]): { user?: string; token?: string; question: string } {
  const rest: string[] = [];
  let user: string | undefined;
  let token: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--user') user = argv[++i];
    else if (argv[i] === '--token') token = argv[++i];
    else rest.push(argv[i]);
  }
  return { user, token, question: rest.join(' ').trim() };
}

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function printEvent(event: AgentEvent): void {
  if (event.type === 'tool_call') console.log(`→ ${event.name} ${JSON.stringify(event.args)}`);
  if (event.type === 'tool_result') {
    const detail = event.isError ? 'error' : `${event.recordIds.length} records: ${event.recordIds.join(' ') || '-'}`;
    console.log(`  ← ${detail}`);
  }
  if (event.type === 'limit_reached') console.log(`! ${event.reason} limit reached, answering with what it has`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));
  if (!args.question) fail('Usage: npm run agent -- --user paula "Should we prioritize dark mode next?"');
  if (!config.OPENROUTER_API_KEY) fail('OPENROUTER_API_KEY is not set in .env');

  const policies = loadPolicyConfig();
  const user = args.user ? policies.users.find((u) => u.id === args.user) : undefined;
  if (args.user && !user) fail(`Unknown user "${args.user}". Known: ${policies.users.map((u) => u.id).join(', ')}`);
  const token = args.token ?? user?.token;
  if (!token) fail('Pass --user <id> or --token <token>');

  const url = config.MCP_URL ?? `http://127.0.0.1:${config.MCP_PORT}/mcp`;
  let tools: McpToolClient;
  try {
    tools = await McpToolClient.connect(url, config.AGENT_KEY, token);
  } catch (error) {
    fail(`Could not connect to the MCP service at ${url} (is "npm run mcp" running?): ${(error as Error).message}`);
  }

  const llm = new OpenRouterChatProvider({
    apiKey: config.OPENROUTER_API_KEY,
    baseUrl: config.OPENROUTER_BASE_URL,
    model: config.OPENROUTER_CHAT_MODEL,
  });
  console.log(`Asking as ${user?.name ?? 'token user'} via ${config.AGENT_KEY} (${llm.name})\n`);

  try {
    const run = await new RoadmapAgent(llm, tools, undefined, printEvent).ask(args.question);
    console.log(`\n${run.answer}\n`);
    console.log('Sources:');
    for (const c of run.citations)
      console.log(`  [${c.externalId}] ${c.source} · ${c.title} · updated ${c.sourceUpdatedAt}`);
    if (run.citations.length === 0) console.log('  (none cited)');
    if (run.unverifiedCitations.length > 0) {
      console.log(`! Cited but never returned by a tool: ${run.unverifiedCitations.join(', ')}`);
    }
  } finally {
    await tools.close();
  }
}

main().catch((error) => fail((error as Error).message));
