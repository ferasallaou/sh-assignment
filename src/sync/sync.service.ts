import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { SOURCE_CONNECTORS } from '../connectors/connectors.module';
import type { SourceConnector, SourceRecord } from '../connectors/source-connector';
import { DB_POOL } from '../database/database.module';
import { FEATURE_CATALOG } from '../knowledge/knowledge.module';
import type { Feature } from '../knowledge/feature-catalog';
import { EMBEDDING_PROVIDER, EmbeddingProvider, toPgVector } from '../providers/embedding-provider';
import { splitIntoChunks } from './chunker';
import { linkRecordToFeatures } from './entity-linker';

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

const EMBED_BATCH_SIZE = 64;

/**
 * Keeps the knowledge base matching the sources.
 *
 * For each source:
 *   1. Ask the connector for changes since the last cursor (skip if the snapshot is unchanged).
 *   2. For each upsert, compare fingerprints with what is stored and apply only what changed.
 *      Each record is applied in ONE transaction: its row, chunks and links change together.
 *   3. Delete records the source no longer has (explicit deletes, or missing from a full snapshot).
 *   4. Save the new cursor.
 * Then fill in embeddings for any chunks that don't have one yet.
 *
 * One failing source is reported and skipped; the others still sync.
 * Running sync twice in a row is safe: the second run changes nothing.
 */
@Injectable()
export class SyncService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(SOURCE_CONNECTORS) private readonly connectors: SourceConnector[],
    @Inject(FEATURE_CATALOG) private readonly catalog: Feature[],
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider | null,
  ) {}

  async syncAll(): Promise<SyncReport> {
    const entityIds = await this.upsertFeatureEntities();

    const sources: SourceSyncReport[] = [];
    for (const connector of this.connectors) {
      sources.push(await this.syncSource(connector, entityIds));
    }

    const embedding = await this.embedPendingChunks();
    return { sources, ...embedding };
  }

  /** The feature catalog is the list of entities records can link to. */
  private async upsertFeatureEntities(): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const feature of this.catalog) {
      const { rows } = await this.pool.query<{ id: string }>(
        `INSERT INTO entities (type, key, name, aliases) VALUES ('feature', $1, $2, $3)
         ON CONFLICT (type, key) DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases
         RETURNING id`,
        [feature.key, feature.name, feature.aliases],
      );
      ids.set(feature.key, rows[0].id);
    }
    return ids;
  }

  private async syncSource(connector: SourceConnector, entityIds: Map<string, string>): Promise<SourceSyncReport> {
    const report: SourceSyncReport = {
      source: connector.sourceName,
      status: 'synced',
      added: 0,
      updated: 0,
      updatedWithoutRechunk: 0,
      unchanged: 0,
      deleted: 0,
      warnings: [],
    };

    try {
      const cursor = await this.readCursor(connector.sourceName);
      const batch = await connector.fetchChanges(cursor ?? undefined);

      if (batch.isFullSnapshot && cursor !== null && batch.nextCursor === cursor) {
        report.status = 'unchanged';
        return report;
      }

      const seenIds: string[] = [];
      const deleteIds: string[] = [];
      for (const change of batch.changes) {
        if (change.type === 'delete') {
          deleteIds.push(change.externalId);
          continue;
        }
        seenIds.push(change.record.externalId);
        const outcome = await this.applyUpsert(connector, change.record, entityIds, report.warnings);
        report[outcome] += 1;
      }

      report.deleted = batch.isFullSnapshot
        ? await this.deleteMissing(connector.sourceName, seenIds)
        : await this.deleteByIds(connector.sourceName, deleteIds);

      await this.saveCursor(connector.sourceName, batch.nextCursor);
    } catch (error) {
      report.status = 'failed';
      report.error = (error as Error).message;
    }
    return report;
  }

  private async applyUpsert(
    connector: SourceConnector,
    record: SourceRecord,
    entityIds: Map<string, string>,
    warnings: string[],
  ): Promise<'added' | 'updated' | 'updatedWithoutRechunk' | 'unchanged'> {
    const contentHash = sha256({ title: record.title, content: record.content });
    const recordHash = sha256(record);

    return this.inTransaction(async (client) => {
      const existing = await client.query<{ id: string; content_hash: string; record_hash: string }>(
        `SELECT id, content_hash, record_hash FROM records
         WHERE source = $1 AND external_id = $2 FOR UPDATE`,
        [connector.sourceName, record.externalId],
      );
      const previous = existing.rows[0];
      if (previous && previous.record_hash === recordHash) return 'unchanged';

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO records (source, external_id, title, content, metadata, allowed_groups,
                              content_hash, record_hash, source_updated_at, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (source, external_id) DO UPDATE SET
           title = EXCLUDED.title, content = EXCLUDED.content, metadata = EXCLUDED.metadata,
           allowed_groups = EXCLUDED.allowed_groups, content_hash = EXCLUDED.content_hash,
           record_hash = EXCLUDED.record_hash, source_updated_at = EXCLUDED.source_updated_at,
           synced_at = now()
         RETURNING id`,
        [
          connector.sourceName,
          record.externalId,
          record.title,
          record.content,
          JSON.stringify(record.metadata),
          record.allowedGroups,
          contentHash,
          recordHash,
          record.updatedAt,
        ],
      );
      const recordId = rows[0].id;

      const textChanged = !previous || previous.content_hash !== contentHash;
      if (textChanged) {
        // Old chunks (and their embeddings) are replaced; new ones get embeddings after the sync.
        await client.query('DELETE FROM chunks WHERE record_id = $1', [recordId]);
        const pieces = splitIntoChunks(record.title, record.content);
        for (const [index, piece] of pieces.entries()) {
          await client.query('INSERT INTO chunks (record_id, chunk_index, content) VALUES ($1, $2, $3)', [
            recordId,
            index,
            piece,
          ]);
        }
      }

      // Links are cheap, so they are always rebuilt; feature IDs or text may have changed.
      await client.query('DELETE FROM links WHERE record_id = $1', [recordId]);
      const { links, unknownFeatureKeys } = linkRecordToFeatures(record, this.catalog);
      for (const link of links) {
        await client.query('INSERT INTO links (record_id, entity_id, relation, matched_by) VALUES ($1, $2, $3, $4)', [
          recordId,
          entityIds.get(link.featureKey),
          connector.linkRelation,
          link.matchedBy,
        ]);
      }
      for (const key of unknownFeatureKeys) {
        warnings.push(`${record.externalId}: feature "${key}" is not in the catalog, not linked`);
      }
      if (record.allowedGroups === null) {
        warnings.push(`${record.externalId}: no permissions in source, denied to everyone`);
      }

      if (!previous) return 'added';
      return textChanged ? 'updated' : 'updatedWithoutRechunk';
    });
  }

  /** Full snapshot: anything stored for this source but not in the snapshot was deleted at the source. */
  private async deleteMissing(source: string, seenIds: string[]): Promise<number> {
    if (seenIds.length === 0) {
      const { rows } = await this.pool.query<{ count: string }>('SELECT count(*) FROM records WHERE source = $1', [
        source,
      ]);
      if (Number(rows[0].count) > 0) {
        // Safety guard: an empty export is far more often a broken export than a real
        // "everything was deleted". Refuse instead of wiping the source.
        throw new Error('snapshot is empty but records exist; refusing to delete them all');
      }
      return 0;
    }
    const result = await this.pool.query('DELETE FROM records WHERE source = $1 AND NOT (external_id = ANY($2))', [
      source,
      seenIds,
    ]);
    return result.rowCount ?? 0;
  }

  private async deleteByIds(source: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pool.query('DELETE FROM records WHERE source = $1 AND external_id = ANY($2)', [
      source,
      ids,
    ]);
    return result.rowCount ?? 0;
  }

  /** Embeds chunks that have no embedding yet. Failures leave them waiting for the next sync. */
  private async embedPendingChunks(): Promise<Omit<SyncReport, 'sources'>> {
    let chunksEmbedded = 0;
    let embeddingError: string | undefined;

    if (this.embedder) {
      try {
        for (;;) {
          const { rows } = await this.pool.query<{ id: string; content: string }>(
            'SELECT id, content FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT $1',
            [EMBED_BATCH_SIZE],
          );
          if (rows.length === 0) break;
          const vectors = await this.embedder.embed(rows.map((row) => row.content));
          if (vectors.length !== rows.length) {
            throw new Error(`embedding provider returned ${vectors.length} vectors for ${rows.length} texts`);
          }
          for (const [index, row] of rows.entries()) {
            await this.pool.query('UPDATE chunks SET embedding = $1::vector WHERE id = $2', [
              toPgVector(vectors[index]),
              row.id,
            ]);
          }
          chunksEmbedded += rows.length;
        }
      } catch (error) {
        embeddingError = (error as Error).message;
      }
    }

    const { rows } = await this.pool.query<{ count: string }>('SELECT count(*) FROM chunks WHERE embedding IS NULL');
    return { chunksEmbedded, chunksWaitingForEmbedding: Number(rows[0].count), embeddingError };
  }

  private async readCursor(source: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ cursor: string | null }>(
      'SELECT cursor FROM sync_state WHERE source = $1',
      [source],
    );
    return rows[0]?.cursor ?? null;
  }

  private async saveCursor(source: string, cursor: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_state (source, cursor, last_synced_at) VALUES ($1, $2, now())
       ON CONFLICT (source) DO UPDATE SET cursor = EXCLUDED.cursor, last_synced_at = now()`,
      [source, cursor],
    );
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
