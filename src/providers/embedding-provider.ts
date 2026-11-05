/**
 * Turns texts into "meaning" vectors for similarity search.
 * The real implementation (OpenRouter, behind LangChain) arrives in step 7.
 * Until then the provider is `null` and chunks wait without embeddings;
 * search can still use full-text matching.
 */
export interface EmbeddingProvider {
  /** A short name for logs, e.g. "openrouter:openai/text-embedding-3-small". */
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Injection token. Resolves to an EmbeddingProvider, or `null` when none is configured. */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Formats a vector the way pgvector expects it in SQL: '[0.1,0.2,...]'. */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
