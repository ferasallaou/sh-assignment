export interface SourceSyncReport {
  source: string;
  status: 'synced' | 'unchanged' | 'failed';
  added: number;
  updated: number;
  /** Only permissions, metadata or links changed: no re-chunking or re-embedding needed. */
  updatedWithoutRechunk: number;
  unchanged: number;
  deleted: number;
  warnings: string[];
  error?: string;
}

export interface SyncReport {
  sources: SourceSyncReport[];
  chunksEmbedded: number;
  /** Chunks still without embeddings (no provider configured, or the provider failed). */
  chunksWaitingForEmbedding: number;
  embeddingError?: string;
}
