/**
 * Starts the web API that the frontend talks to (streams agent runs over SSE).
 *
 * Usage: npm run api   (listens on API_PORT, default 3200)
 * Needs OPENROUTER_API_KEY and the MCP service running (npm run mcp). `npm run dev` starts all three.
 */
import { AgentApiServer } from '../src/api/agent-api.server';
import { loadConfig } from '../src/config';
import { loadPolicyConfig } from '../src/policy/policy-config';
import { OpenRouterChatProvider } from '../src/providers/openrouter-chat.provider';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set in backend/.env');
  const llm = new OpenRouterChatProvider({
    apiKey: config.OPENROUTER_API_KEY,
    baseUrl: config.OPENROUTER_BASE_URL,
    model: config.OPENROUTER_CHAT_MODEL,
  });
  const mcpUrl = config.MCP_URL ?? `http://127.0.0.1:${config.MCP_PORT}/mcp`;
  const server = new AgentApiServer(loadPolicyConfig(), llm, mcpUrl);
  const url = await server.listen(config.API_PORT);
  console.log(`Web API listening on ${url} (agent model ${llm.name}, MCP at ${mcpUrl})`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`✖ ${(error as Error).message}`);
  process.exit(1);
});
