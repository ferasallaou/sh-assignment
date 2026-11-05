import { createHash } from 'node:crypto';
import type { SourceName } from '../policy/policy-config';

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

/**
 * Builds a full-snapshot batch from every current record.
 * The cursor is a fingerprint of the whole snapshot: if nothing changed, it stays the same.
 */
export function snapshotBatch(records: SourceRecord[]): ChangeBatch {
  const ids = records.map((record) => record.externalId);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) {
    throw new Error(`Duplicate record ID "${duplicate}" in source`);
  }

  const fingerprint = createHash('sha256');
  for (const record of [...records].sort((a, b) => a.externalId.localeCompare(b.externalId))) {
    fingerprint.update(JSON.stringify(record));
  }

  return {
    isFullSnapshot: true,
    changes: records.map((record) => ({ type: 'upsert', record })),
    nextCursor: fingerprint.digest('hex'),
  };
}

/** Turns a list like "sales;product" or ["sales"] into groups. Missing means unknown (`null`). */
export function normalizeGroups(value: string | string[] | null | undefined): string[] | null {
  if (value === undefined || value === null) return null;
  const list = Array.isArray(value) ? value : value.split(';');
  const groups = list.map((group) => group.trim()).filter((group) => group.length > 0);
  // A present-but-empty value is treated the same as missing: nobody gets access.
  return groups.length > 0 ? groups : null;
}

/**
 * Wraps a parsing error with the file and item it came from.
 * Connectors fail the whole source on any bad item, on purpose: a partial snapshot
 * would make the sync delete every item that failed to parse.
 */
export function parseError(file: string, item: string, message: string): Error {
  return new Error(`${file}: ${item}: ${message}`);
}
