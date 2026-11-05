// Feature is defined by its validation schema, so it is inferred there and re-exported here.
export type { Feature } from '../knowledge/feature-catalog';

/** One piece of knowledge the caller is allowed to see, with where it came from. */
export interface KnowledgeResult {
  source: string;
  externalId: string;
  title: string;
  /** The matching text (a chunk for search, the full record for feature context). */
  text: string;
  /** When the source last changed this record (ISO 8601). */
  sourceUpdatedAt: string;
  /** Features this record is linked to, e.g. ['dark-mode']. */
  features: string[];
}

export interface SearchResponse {
  /** 'hybrid' = keywords + meaning; 'keyword' = no embedding provider (or it failed). */
  mode: 'hybrid' | 'keyword';
  results: KnowledgeResult[];
}

export interface FeatureContextResult extends KnowledgeResult {
  /** How the record relates to the feature: 'requests', 'implements' or 'describes'. */
  relation: string;
  /** How the link was found: 'id' (explicit in the source) or 'alias' (name match). */
  matchedBy: string;
}
