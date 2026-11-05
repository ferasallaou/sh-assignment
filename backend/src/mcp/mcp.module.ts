import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PolicyModule } from '../policy/policy.module';
import { AuditService } from './audit.service';
import { McpService } from './mcp.service';

@Module({
  imports: [KnowledgeModule, PolicyModule, HrModule],
  providers: [AuditService, McpService],
  exports: [McpService],
})
export class McpModule {}
