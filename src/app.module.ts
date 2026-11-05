import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { SyncModule } from './sync/sync.module';

/**
 * Root module. Feature modules (policy, mcp, agent) are added here
 * as each build step lands.
 */
@Module({
  imports: [DatabaseModule, SyncModule],
})
export class AppModule {}
