/**
 * Step 1 check: the database is reachable, pgvector works, and the schema is in place.
 * Needs the database running: `npm run db:up`.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { DB_POOL } from '../src/database/database.module';
import { migrate } from '../scripts/migrate';
import { loadConfig } from '../src/config';

describe('database setup', () => {
  let pool: Pool;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // No HTTP server is needed here, so we start only the dependency-injection container.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    pool = moduleRef.get<Pool>(DB_POOL);
    close = () => moduleRef.close();
    await migrate(pool);
  });

  afterAll(async () => {
    await close();
  });

  it('has all knowledge tables', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining(['records', 'chunks', 'entities', 'links', 'sync_state', 'audit_log']),
    );
  });

  it('can compute vector similarity (pgvector is installed)', async () => {
    const { rows } = await pool.query<{ distance: number }>(
      `SELECT '[1,0,0]'::vector <=> '[0,1,0]'::vector AS distance`,
    );
    expect(rows[0].distance).toBeCloseTo(1); // cosine distance of perpendicular vectors
  });

  it('builds the full-text search column automatically', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); // rolled back, so the test leaves no data behind
      const record = await client.query<{ id: string }>(
        `INSERT INTO records (source, external_id, title, content, allowed_groups, content_hash, source_updated_at)
         VALUES ('test', 'T-1', 'Test', 'Customers keep asking for dark mode', '{product}', 'h', now())
         RETURNING id`,
      );
      await client.query(
        `INSERT INTO chunks (record_id, chunk_index, content) VALUES ($1, 0, 'Customers keep asking for dark mode')`,
        [record.rows[0].id],
      );
      // Only look at this test's record: other test files may have left data in the test database.
      const match = await client.query(
        `SELECT 1 FROM chunks WHERE record_id = $1 AND tsv @@ plainto_tsquery('english', 'asking dark')`,
        [record.rows[0].id],
      );
      expect(match.rowCount).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects an invalid DATABASE_URL with a clear message', () => {
    expect(() => loadConfig({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });
});
