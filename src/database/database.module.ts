import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfig } from '../config';

/** Injection token for the shared PostgreSQL connection pool. */
export const DB_POOL = Symbol('DB_POOL');

/**
 * Provides one PostgreSQL connection pool to the whole app.
 * Other modules inject it with `@Inject(DB_POOL) pool: Pool`.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      useFactory: () => new Pool({ connectionString: loadConfig().DATABASE_URL }),
    },
  ],
  exports: [DB_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
