/**
 * Turns texts into "meaning" vectors for similarity search.
 * The real implementation is OpenRouter through LangChain (openrouter-embedding.provider.ts).
 * With no API key the provider is `null`: chunks wait without embeddings and
 * search uses full-text matching only.
 */
export interface EmbeddingProvider {
  /**
   * Identifies the model, e.g. "openrouter:openai/text-embedding-3-small". It is stored with every
   * embedding, so vectors from different models are never compared and a model change re-embeds.
   */
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Injection token. Resolves to an EmbeddingProvider, or `null` when none is configured. */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Formats a vector the way pgvector expects it in SQL: '[0.1,0.2,...]'. */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
