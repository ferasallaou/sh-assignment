import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const featureSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes'),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
});

const catalogSchema = z.object({ features: z.array(featureSchema) });

export type Feature = z.infer<typeof featureSchema>;

export const DEFAULT_FEATURE_CATALOG_PATH = join(__dirname, '..', '..', 'data', 'features.yaml');

/** Reads and validates data/features.yaml, the list of features records can be linked to. */
export function loadFeatureCatalog(path: string = DEFAULT_FEATURE_CATALOG_PATH): Feature[] {
  const result = catalogSchema.safeParse(parse(readFileSync(path, 'utf8')));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid features.yaml:\n${problems}`);
  }
  return result.data.features;
}
