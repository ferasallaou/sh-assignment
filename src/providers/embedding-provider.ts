/** Injection token. Resolves to an EmbeddingProvider, or `null` when none is configured. */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Formats a vector the way pgvector expects it in SQL: '[0.1,0.2,...]'. */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
