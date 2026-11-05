import { Module } from '@nestjs/common';
import { ConnectorsModule } from './connectors/connectors.module';
import { DatabaseModule } from './database/database.module';

/**
 * Root module. Feature modules (connectors, sync, knowledge, policy, mcp,
 * providers, agent) are added here as each build step lands.
 */
@Module({
  imports: [DatabaseModule, ConnectorsModule],
})
export class AppModule {}
