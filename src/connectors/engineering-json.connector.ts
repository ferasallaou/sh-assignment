import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChangeBatch, SourceConnector, SourceRecord } from '../types';
import { normalizeGroups, parseError, snapshotBatch } from './source-connector';

const DEFAULT_FILE = join(__dirname, '..', '..', 'data', 'sources', 'engineering', 'tickets.json');

const ticketSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  feature: z.string().nullable().optional(),
  status: z.string().min(1),
  estimate_weeks: z.number().nonnegative().optional(),
  // Optional on purpose: a missing value means "permissions unknown", which is denied by default.
  allowed_groups: z.array(z.string()).optional(),
  updated_at: z.iso.datetime(),
});

/** Reads Engineering tickets from a JSON export (an array of tickets). */
export class EngineeringJsonConnector implements SourceConnector {
  readonly sourceName = 'engineering' as const;
  readonly linkRelation = 'implements';

  constructor(private readonly file: string = DEFAULT_FILE) {}

  async fetchChanges(): Promise<ChangeBatch> {
    let tickets: unknown;
    try {
      tickets = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (error) {
      throw parseError(this.file, 'file', `not valid JSON (${(error as Error).message})`);
    }
    if (!Array.isArray(tickets)) {
      throw parseError(this.file, 'file', 'expected an array of tickets');
    }
    return snapshotBatch(tickets.map((ticket, index) => this.toRecord(ticket, index)));
  }

  private toRecord(ticket: unknown, index: number): SourceRecord {
    const result = ticketSchema.safeParse(ticket);
    if (!result.success) {
      throw parseError(
        this.file,
        `ticket #${index}`,
        result.error.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      );
    }
    const t = result.data;
    const estimate = t.estimate_weeks !== undefined ? ` Estimate: ${t.estimate_weeks} weeks.` : '';
    return {
      externalId: t.id,
      title: t.title,
      content: `${t.title}. Status: ${t.status}.${estimate} ${t.description}`,
      metadata: { status: t.status, estimateWeeks: t.estimate_weeks ?? null },
      allowedGroups: normalizeGroups(t.allowed_groups),
      explicitFeatureKeys: t.feature ? [t.feature] : [],
      updatedAt: t.updated_at,
    };
  }
}
