/**
 * Applies the SQL files in db/migrations in name order, once each.
 * Applied files are recorded in schema_migrations, so running this twice is safe.
 *
 * Usage: npm run db:migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { loadConfig } from '../src/config';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const alreadyApplied = new Set(rows.map((row) => row.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const appliedNow: string[] = [];
  for (const file of files) {
    if (alreadyApplied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      // Each file runs in its own transaction: it applies fully or not at all.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      appliedNow.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }
  return appliedNow;
}

/**
 * Creates the database in `url` if it doesn't exist yet, then applies migrations.
 * Used for the separate test and demo databases, so they never touch the main demo data.
 */
export async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = target.pathname.slice(1);
  const adminUrl = new URL(target);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: target.toString() });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
