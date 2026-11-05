/**
 * Calls the configured chat and embedding models once each, to check the key and model names.
 * Costs a fraction of a cent. Usage: npm run models:check
 */
import 'reflect-metadata';
import { loadConfig } from '../src/config';
import { OpenRouterChatProvider } from '../src/providers/openrouter-chat.provider';
import { OpenRouterEmbeddingProvider } from '../src/providers/openrouter-embedding.provider';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set in .env');
    process.exit(1);
  }
  const options = { apiKey: config.OPENROUTER_API_KEY, baseUrl: config.OPENROUTER_BASE_URL };

  const embedder = new OpenRouterEmbeddingProvider({ ...options, model: config.OPENROUTER_EMBEDDING_MODEL });
  const [vector] = await embedder.embed(['dark mode for the retailer dashboard']);
  console.log(`✔ ${embedder.name}: ${vector.length} numbers per text`);

  const chat = new OpenRouterChatProvider({ ...options, model: config.OPENROUTER_CHAT_MODEL });
  const reply = await chat.generate(
    [
      { role: 'system', content: 'Use the tool to answer.' },
      { role: 'user', content: 'What do we know about dark mode?' },
    ],
    [
      {
        name: 'get_feature_context',
        description: 'Returns records linked to a feature.',
        inputSchema: { type: 'object', properties: { feature: { type: 'string' } }, required: ['feature'] },
      },
    ],
  );
  const detail = reply.type === 'tool_calls' ? JSON.stringify(reply.calls) : JSON.stringify(reply.text);
  console.log(`✔ ${chat.name}: replied with ${reply.type} ${detail}`);
}

main().catch((error) => {
  console.error(`✖ ${(error as Error).message}`);
  process.exit(1);
});
