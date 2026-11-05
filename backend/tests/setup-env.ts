// Runs before each test file: point the app at the test database.
import { testDatabaseUrl } from './test-database';

process.env.DATABASE_URL = testDatabaseUrl();
