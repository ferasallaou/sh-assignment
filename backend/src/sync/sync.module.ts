import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ProvidersModule } from '../providers/providers.module';
import { SyncService } from './sync.service';

@Module({
  imports: [ConnectorsModule, KnowledgeModule, ProvidersModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
