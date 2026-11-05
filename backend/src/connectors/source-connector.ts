import { createHash } from 'node:crypto';
import type { ChangeBatch, SourceRecord } from '../types';

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
