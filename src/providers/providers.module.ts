import { Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding-provider';

/**
 * AI model providers. Step 7 replaces the `null` below with the OpenRouter
 * embedding provider when OPENROUTER_API_KEY is set.
 */
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (): EmbeddingProvider | null => null,
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class ProvidersModule {}
