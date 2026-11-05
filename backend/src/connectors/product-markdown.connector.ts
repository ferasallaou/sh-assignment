import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { ChangeBatch, SourceConnector, SourceName, SourceRecord } from '../types';
import { normalizeGroups, parseError, snapshotBatch } from './source-connector';

const DEFAULT_DIR = join(__dirname, '..', '..', 'data', 'sources', 'product');

/** Splits "---\n<yaml>\n---\n<body>" into its two parts. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const frontMatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  feature: z.string().optional(),
  // Optional on purpose: a missing value means "permissions unknown", which is denied by default.
  allowed_groups: z.array(z.string()).optional(),
  updated_at: z.iso.datetime(),
});

/**
 * Reads a folder of documents: one Markdown file per document, with YAML front matter.
 * Used by Product (below) and HR (hr-markdown.connector.ts), which keep documents the same way.
 */
export class MarkdownDocsConnector implements SourceConnector {
  readonly linkRelation = 'describes';

  constructor(
    readonly sourceName: SourceName,
    private readonly dir: string,
  ) {}

  async fetchChanges(): Promise<ChangeBatch> {
    const files = readdirSync(this.dir)
      .filter((file) => file.endsWith('.md') && file !== 'README.md')
      .sort();
    return snapshotBatch(files.map((file) => this.toRecord(file)));
  }

  private toRecord(file: string): SourceRecord {
    const text = readFileSync(join(this.dir, file), 'utf8');
    const match = FRONT_MATTER.exec(text);
    if (!match) {
      throw parseError(file, 'front matter', 'missing the --- block at the top');
    }

    // The yaml package keeps ISO dates as strings, which is what the schema expects.
    const result = frontMatterSchema.safeParse(parse(match[1]));
    if (!result.success) {
      throw parseError(file, 'front matter', result.error.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    }
    const meta = result.data;
    return {
      externalId: meta.id,
      title: meta.title,
      content: match[2].trim(),
      metadata: { file },
      allowedGroups: normalizeGroups(meta.allowed_groups),
      explicitFeatureKeys: meta.feature ? [meta.feature] : [],
      updatedAt: meta.updated_at,
    };
  }
}

/** Product documents (briefs, roadmap drafts, feedback digests). */
export class ProductMarkdownConnector extends MarkdownDocsConnector {
  constructor(dir: string = DEFAULT_DIR) {
    super('product', dir);
  }
}
