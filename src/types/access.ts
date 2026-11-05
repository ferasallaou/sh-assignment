// Agent and user policies are defined by their validation schemas, so their types are
// inferred there and only re-exported here.
import type { AgentPolicy, UserPolicy } from '../policy/policy-config';

export type { AgentPolicy, PolicyConfig, SourceName, ToolName, UserPolicy } from '../policy/policy-config';

/**
 * Who is asking: the calling agent and the user it acts for.
 * Always resolved by the service from verified keys (step 6), never taken from model output.
 */
export interface VerifiedCaller {
  agent: AgentPolicy;
  user: UserPolicy;
}

/**
 * What a caller may read. A record is visible only if BOTH:
 *   - its source is in the agent's scope, AND
 *   - the user is in at least one of its allowed groups.
 * This is applied inside the SQL query (see knowledge-search.service.ts).
 */
export interface AccessScope {
  sources: string[];
  groups: string[];
}
