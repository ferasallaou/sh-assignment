import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { ChangeBatch, SourceConnector, SourceRecord } from '../types';
import { normalizeGroups, parseError, snapshotBatch } from './source-connector';

const DEFAULT_FILE = join(__dirname, '..', '..', 'data', 'sources', 'sales', 'feature_requests.csv');

const rowSchema = z.object({
  id: z.string().min(1),
  account: z.string().min(1),
  feature_id: z.string(),
  request: z.string().min(1),
  deal_value_eur: z.coerce.number().nonnegative(),
  stage: z.string().min(1),
  allowed_groups: z.string(),
  updated_at: z.iso.datetime(),
});

/** Reads Sales customer requests from a CSV export (one row per request). */
export class SalesCsvConnector implements SourceConnector {
  readonly sourceName = 'sales' as const;
  readonly linkRelation = 'requests';

  constructor(private readonly file: string = DEFAULT_FILE) {}

  async fetchChanges(): Promise<ChangeBatch> {
    const rows: unknown[] = parse(readFileSync(this.file, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    return snapshotBatch(rows.map((row, index) => this.toRecord(row, index + 2)));
  }

  private toRecord(row: unknown, lineNumber: number): SourceRecord {
    const result = rowSchema.safeParse(row);
    if (!result.success) {
      throw parseError(
        this.file,
        `line ${lineNumber}`,
        result.error.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      );
    }
    const r = result.data;
    return {
      externalId: r.id,
      title: `${r.account}: customer request`,
      content: `${r.account} (${r.stage}, deal value ${r.deal_value_eur} EUR): ${r.request}`,
      metadata: { account: r.account, stage: r.stage, dealValueEur: r.deal_value_eur },
      allowedGroups: normalizeGroups(r.allowed_groups),
      explicitFeatureKeys: r.feature_id ? [r.feature_id] : [],
      updatedAt: r.updated_at,
    };
  }
}
