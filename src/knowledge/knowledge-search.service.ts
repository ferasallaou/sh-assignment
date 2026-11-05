import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';
import { accessScopeOf, VerifiedCaller } from '../policy/caller';
import { EMBEDDING_PROVIDER, EmbeddingProvider, toPgVector } from '../providers/embedding-provider';

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

/** How many candidates each ranking contributes before they are merged. */
const CANDIDATES_PER_RANKING = 20;
/** Standard constant for reciprocal rank fusion; dampens the gap between rank 1 and rank 2. */
const RRF_K = 60;

/**
 * The single "who may see what" condition, used by every query below.
 * $1 = the agent's allowed sources, $2 = the user's groups.
 * allowed_groups NULL (unknown) makes `&&` return NULL, so the row never matches: deny by default.
 */
const ACCESS_FILTER = `r.source = ANY($1::text[]) AND r.allowed_groups && $2::text[]`;

/**
 * Reads knowledge on behalf of a verified caller.
 *
 * Permissions are applied inside the SQL, before ranking and before anything is returned,
 * so restricted records never leave the database. A restricted record and a missing one
 * produce the same answer: nothing. No counts or "hidden results" hints are returned.
 */
@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider | null,
  ) {}

  /**
   * Finds the best matching pieces of permitted knowledge for a question.
   * Combines keyword ranking (PostgreSQL full-text) and meaning ranking (pgvector),
   * merged with reciprocal rank fusion. One result per record, best piece first.
   */
  async search(caller: VerifiedCaller, query: string, limit = 5): Promise<SearchResponse> {
    const scope = accessScopeOf(caller);
    const queryVector = await this.embedQuery(query);

    const { rows } = await this.pool.query<ResultRow & { record_id: string }>(
      `WITH allowed AS (
         SELECT c.id, c.tsv, c.embedding, c.embedding_model
         FROM chunks c JOIN records r ON r.id = c.record_id
         WHERE ${ACCESS_FILTER}
       ),
       -- Questions are natural language, so match ANY of the words (OR), not all of them.
       q AS (
         SELECT to_tsquery('english', replace(plainto_tsquery('english', $3)::text, '&', '|')) AS terms
       ),
       keyword AS (
         SELECT a.id, row_number() OVER (ORDER BY ts_rank_cd(a.tsv, q.terms) DESC, a.id) AS rank
         FROM allowed a, q
         WHERE a.tsv @@ q.terms
         ORDER BY rank LIMIT ${CANDIDATES_PER_RANKING}
       ),
       meaning AS (
         SELECT a.id, row_number() OVER (ORDER BY a.embedding <=> $4::vector, a.id) AS rank
         FROM allowed a
         -- Only compare with vectors from the same model as the question's vector.
         WHERE $4::vector IS NOT NULL AND a.embedding IS NOT NULL AND a.embedding_model = $5
         ORDER BY rank LIMIT ${CANDIDATES_PER_RANKING}
       ),
       fused AS (
         SELECT id, sum(1.0 / (${RRF_K} + rank)) AS score
         FROM (SELECT id, rank FROM keyword UNION ALL SELECT id, rank FROM meaning) ranked
         GROUP BY id
       )
       SELECT r.id AS record_id, r.source, r.external_id, r.title, c.content AS text,
              r.source_updated_at, ${FEATURES_OF_RECORD} AS features
       FROM fused f
       JOIN chunks c ON c.id = f.id
       JOIN records r ON r.id = c.record_id
       ORDER BY f.score DESC, c.id`,
      [scope.sources, scope.groups, query, queryVector, this.embedder?.name ?? null],
    );

    // Several pieces of one record can match; keep only the best one per record.
    const seen = new Set<string>();
    const results: KnowledgeResult[] = [];
    for (const row of rows) {
      if (seen.has(row.record_id)) continue;
      seen.add(row.record_id);
      results.push(toResult(row));
      if (results.length === limit) break;
    }
    return { mode: queryVector ? 'hybrid' : 'keyword', results };
  }

  /**
   * Every permitted record linked to a feature, newest first within each source.
   * An unknown feature and a feature whose records are all restricted both return [].
   */
  async getFeatureContext(caller: VerifiedCaller, featureKey: string): Promise<FeatureContextResult[]> {
    const scope = accessScopeOf(caller);
    const { rows } = await this.pool.query<ResultRow & { relation: string; matched_by: string }>(
      `SELECT r.source, r.external_id, r.title, r.content AS text, r.source_updated_at,
              ${FEATURES_OF_RECORD} AS features, l.relation, l.matched_by
       FROM entities e
       JOIN links l ON l.entity_id = e.id
       JOIN records r ON r.id = l.record_id
       WHERE e.type = 'feature' AND e.key = $3 AND ${ACCESS_FILTER}
       ORDER BY r.source, r.source_updated_at DESC, r.external_id`,
      [scope.sources, scope.groups, featureKey],
    );
    return rows.map((row) => ({ ...toResult(row), relation: row.relation, matchedBy: row.matched_by }));
  }

  /** Returns the query as a pgvector literal, or null to fall back to keyword-only search. */
  private async embedQuery(query: string): Promise<string | null> {
    if (!this.embedder) return null;
    try {
      const [vector] = await this.embedder.embed([query]);
      return vector ? toPgVector(vector) : null;
    } catch (error) {
      // A model outage should degrade search quality, not break it.
      this.logger.warn(`Query embedding failed, using keyword search only: ${(error as Error).message}`);
      return null;
    }
  }
}

/** Feature keys linked to record `r`. Feature names are a shared catalog, not restricted data. */
const FEATURES_OF_RECORD = `ARRAY(
  SELECT e2.key FROM links l2 JOIN entities e2 ON e2.id = l2.entity_id
  WHERE l2.record_id = r.id ORDER BY e2.key
)`;

interface ResultRow {
  source: string;
  external_id: string;
  title: string;
  text: string;
  source_updated_at: Date;
  features: string[];
}

function toResult(row: ResultRow): KnowledgeResult {
  return {
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    text: row.text,
    sourceUpdatedAt: row.source_updated_at.toISOString(),
    features: row.features,
  };
}
