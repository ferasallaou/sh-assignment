-- Which model produced each chunk's embedding.
-- Vectors from different models can't be compared (and often differ in length), so:
--   - sync re-embeds chunks whose model differs from the configured one, and
--   - search only compares the question with chunks embedded by the same model.
-- This makes switching OPENROUTER_EMBEDDING_MODEL safe: the next sync re-embeds everything.
ALTER TABLE chunks ADD COLUMN embedding_model TEXT;
