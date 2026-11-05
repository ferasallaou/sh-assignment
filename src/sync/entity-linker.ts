import type { SourceRecord } from '../connectors/source-connector';
import type { Feature } from '../knowledge/feature-catalog';

export interface FeatureLink {
  featureKey: string;
  matchedBy: 'id' | 'alias';
}

export interface LinkResult {
  links: FeatureLink[];
  /** Explicit IDs that aren't in the catalog. Reported, not linked. */
  unknownFeatureKeys: string[];
}

/**
 * Finds which features a record is about. Deterministic and explainable, no AI:
 *   1. Explicit feature IDs given by the source (strongest signal).
 *   2. Known aliases or the feature name appearing as a whole phrase in the
 *      title or text, ignoring case ("night mode" → dark-mode).
 *
 * Known limits (stated in the design doc): misses misspellings and paraphrases
 * ("the black theme"), and a negative mention ("we will NOT do dark mode") still links.
 * Production could add reviewed AI-suggested links on top.
 */
export function linkRecordToFeatures(record: SourceRecord, catalog: Feature[]): LinkResult {
  const known = new Map(catalog.map((feature) => [feature.key, feature]));
  const links: FeatureLink[] = [];
  const unknownFeatureKeys: string[] = [];

  for (const key of record.explicitFeatureKeys) {
    if (known.has(key)) {
      links.push({ featureKey: key, matchedBy: 'id' });
    } else {
      unknownFeatureKeys.push(key);
    }
  }

  const text = `${record.title}\n${record.content}`;
  for (const feature of catalog) {
    if (links.some((link) => link.featureKey === feature.key)) continue;
    const phrases = [feature.name, ...feature.aliases];
    if (phrases.some((phrase) => containsPhrase(text, phrase))) {
      links.push({ featureKey: feature.key, matchedBy: 'alias' });
    }
  }

  return { links, unknownFeatureKeys };
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word boundaries on both sides, so "csv export" doesn't match inside "csv exporter".
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}
