import 'dotenv/config';

/**
 * Tests use their own database (knowledge_test by default) so running them
 * never wipes the demo data synced into the main database.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const main = new URL(process.env.DATABASE_URL ?? 'postgres://knowledge:knowledge@localhost:5433/knowledge');
  main.pathname = '/knowledge_test';
  return main.toString();
}
