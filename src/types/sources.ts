import type { SourceName } from './access';

/**
 * One item from a source system, already reshaped into the common format
 * every connector must produce.
 */
export interface SourceRecord {
  /** The item's ID inside its source, e.g. "S-101" or "ENG-42". */
  externalId: string;
  title: string;
  /** The text that will be searched. */
  content: string;
  /** Source-specific fields kept for answers and filtering (stage, status, ...). */
  metadata: Record<string, unknown>;
  /**
   * Groups allowed to see this item.
   * `null` means the source gave no permissions: the record is stored but denied to everyone.
   */
  allowedGroups: string[] | null;
  /** Feature keys the source names explicitly (strongest kind of link). */
  explicitFeatureKeys: string[];
  /** When the source last changed the item (ISO 8601). */
  updatedAt: string;
}

export type SourceChange = { type: 'upsert'; record: SourceRecord } | { type: 'delete'; externalId: string };

export interface ChangeBatch {
  /**
   * `true`: `changes` lists every item that currently exists (only upserts).
   * The sync must delete stored items that are missing from it (reconciliation).
   * Used by sources that can't report deletions, like plain files.
   *
   * `false`: `changes` holds only what changed since `cursor`, with explicit deletes.
   * Used by sources with a change feed or webhooks (production connectors).
   */
  isFullSnapshot: boolean;
  changes: SourceChange[];
  /** Pass back on the next call. For snapshots it is a fingerprint, so unchanged sources can be skipped. */
  nextCursor: string;
}

export interface SourceConnector {
  sourceName: SourceName;
  /** How this source's records relate to the features they mention, e.g. Sales "requests" a feature. */
  linkRelation: string;
  fetchChanges(cursor?: string): Promise<ChangeBatch>;
}
