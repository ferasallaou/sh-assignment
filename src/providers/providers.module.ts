import { Module } from '@nestjs/common';
import { loadConfig } from '../config';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding-provider';
import { LLM_PROVIDER, LlmProvider } from './llm-provider';
import { OpenRouterChatProvider } from './openrouter-chat.provider';
import { OpenRouterEmbeddingProvider } from './openrouter-embedding.provider';

/**
 * AI model providers. Both use OpenRouter when OPENROUTER_API_KEY is set, and are `null`
 * otherwise: sync and search still work (keywords only), the agent can't run.
 */
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (): EmbeddingProvider | null => {
        const config = loadConfig();
        if (!config.OPENROUTER_API_KEY) return null;
        return new OpenRouterEmbeddingProvider({
          apiKey: config.OPENROUTER_API_KEY,
          baseUrl: config.OPENROUTER_BASE_URL,
          model: config.OPENROUTER_EMBEDDING_MODEL,
        });
      },
    },
    {
      provide: LLM_PROVIDER,
      useFactory: (): LlmProvider | null => {
        const config = loadConfig();
        if (!config.OPENROUTER_API_KEY) return null;
        return new OpenRouterChatProvider({
          apiKey: config.OPENROUTER_API_KEY,
          baseUrl: config.OPENROUTER_BASE_URL,
          model: config.OPENROUTER_CHAT_MODEL,
        });
      },
    },
  ],
  exports: [EMBEDDING_PROVIDER, LLM_PROVIDER],
})
export class ProvidersModule {}
