import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';

/**
 * Root module. Feature modules (connectors, sync, knowledge, policy, mcp,
 * providers, agent) are added here as each build step lands.
 */
@Module({
  imports: [DatabaseModule],
})
export class AppModule {}
