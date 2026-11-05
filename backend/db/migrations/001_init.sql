-- Knowledge store schema.
-- Four core concepts: records, chunks, entities, links.
-- Plus sync state (where each source's last sync stopped) and an audit log.

CREATE EXTENSION IF NOT EXISTS vector;

-- One item from a source system (a deal, a ticket, a product doc).
-- Permissions live here; chunks inherit them by joining back to their record,
-- so there is exactly one copy of the rule and it can never drift between tables.
CREATE TABLE records (
  id                BIGSERIAL PRIMARY KEY,
  source            TEXT        NOT NULL,          -- e.g. 'sales', 'engineering', 'product'
  external_id       TEXT        NOT NULL,          -- the ID inside the source system
  title             TEXT        NOT NULL,
  content           TEXT        NOT NULL,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- NULL means "permissions unknown" and is always denied (deny by default).
  -- An empty array also matches nobody.
  allowed_groups    TEXT[],
  content_hash      TEXT        NOT NULL,          -- detects edits between syncs
  source_updated_at TIMESTAMPTZ NOT NULL,          -- when the source last changed it
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX records_allowed_groups_idx ON records USING GIN (allowed_groups);

-- Searchable pieces of a record: full-text and vector search.
-- Deleting a record deletes its chunks (ON DELETE CASCADE).
CREATE TABLE chunks (
  id          BIGSERIAL PRIMARY KEY,
  record_id   BIGINT  NOT NULL REFERENCES records (id) ON DELETE CASCADE,
  chunk_index INT     NOT NULL,
  content     TEXT    NOT NULL,
  -- Dimension is left open so the embedding model can be changed in .env.
  -- Trade-off: no approximate (HNSW) index without a fixed dimension; exact search
  -- is fine at PoC size. Production would fix the dimension and add an index.
  embedding   vector,
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (record_id, chunk_index)
);

CREATE INDEX chunks_tsv_idx ON chunks USING GIN (tsv);

-- Shared business objects that records talk about, e.g. Feature "Dark mode".
CREATE TABLE entities (
  id      BIGSERIAL PRIMARY KEY,
  type    TEXT   NOT NULL,                         -- e.g. 'feature'
  key     TEXT   NOT NULL,                         -- stable ID, e.g. 'dark-mode'
  name    TEXT   NOT NULL,                         -- display name, e.g. 'Dark mode'
  aliases TEXT[] NOT NULL DEFAULT '{}',            -- e.g. {'dark theme', 'night mode'}
  UNIQUE (type, key)
);

-- Relationships between records and entities, e.g. ticket ENG-42 'implements' dark-mode.
CREATE TABLE links (
  record_id BIGINT NOT NULL REFERENCES records (id)  ON DELETE CASCADE,
  entity_id BIGINT NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  relation  TEXT   NOT NULL,                         -- e.g. 'requests', 'implements', 'describes'
  matched_by TEXT  NOT NULL,                         -- 'id' or 'alias', so links are explainable
  PRIMARY KEY (record_id, entity_id, relation)
);

-- Where each source's last sync stopped.
CREATE TABLE sync_state (
  source         TEXT PRIMARY KEY,
  cursor         TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every tool call through the MCP service, allowed or not.
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_id     TEXT,
  user_id      TEXT,
  tool         TEXT        NOT NULL,
  arguments    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  allowed      BOOLEAN     NOT NULL,
  result_count INT
);
