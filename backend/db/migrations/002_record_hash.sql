-- Two fingerprints per record, so sync can tell what kind of change happened:
--   content_hash: title + text only. Changes here mean re-chunking and re-embedding.
--   record_hash:  everything (text, permissions, metadata, feature IDs, dates).
-- If only record_hash changed (for example, permissions were changed in the source),
-- sync updates the record and its links without the cost of re-chunking and re-embedding.
-- Chunks read permissions from their record, so a permission change applies immediately.
ALTER TABLE records ADD COLUMN record_hash TEXT NOT NULL DEFAULT '';
