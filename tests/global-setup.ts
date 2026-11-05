// Runs once before all tests: create the test database if needed and apply migrations.
import { Client, Pool } from 'pg';
import { migrate } from '../scripts/migrate';
import { testDatabaseUrl } from './test-database';

export default async function globalSetup(): Promise<void> {
  const testUrl = new URL(testDatabaseUrl());
  const databaseName = testUrl.pathname.slice(1);

  const adminUrl = new URL(testUrl);
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

  const pool = new Pool({ connectionString: testUrl.toString() });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
