import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PolicyModule } from '../policy/policy.module';
import { AuditService } from './audit.service';
import { McpService } from './mcp.service';

@Module({
  imports: [KnowledgeModule, PolicyModule],
  providers: [AuditService, McpService],
  exports: [McpService],
})
export class McpModule {}
