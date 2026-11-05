import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { McpModule } from './mcp/mcp.module';
import { SyncModule } from './sync/sync.module';

/**
 * Root module. Feature modules (agent) are added here
 * as each build step lands.
 */
@Module({
  imports: [DatabaseModule, SyncModule, McpModule],
})
export class AppModule {}
