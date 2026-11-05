// Runs once before all tests: create the test database if needed and apply migrations.
import { ensureDatabase } from '../scripts/migrate';
import { testDatabaseUrl } from './test-database';

export default async function globalSetup(): Promise<void> {
  await ensureDatabase(testDatabaseUrl());
}
