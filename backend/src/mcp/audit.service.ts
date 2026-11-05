import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';

export interface AuditEntry {
  agentId: string;
  userId: string;
  tool: string;
  arguments: unknown;
  /** false = the caller was not allowed to use this tool. */
  allowed: boolean;
  /** How many results were returned; null when the call was refused or failed. */
  resultCount: number | null;
}

/**
 * Records every tool call, allowed or not, so access can be reviewed later
 * ("who asked for what, on whose behalf, and what did they get?").
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (agent_id, user_id, tool, arguments, allowed, result_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.agentId,
        entry.userId,
        entry.tool,
        JSON.stringify(entry.arguments ?? {}),
        entry.allowed,
        entry.resultCount,
      ],
    );
  }
}
