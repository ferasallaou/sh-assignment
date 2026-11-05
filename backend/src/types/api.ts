// The web API's contract. The frontend imports these types directly (type-only), so this file
// must only depend on other plain type files (agent.ts, models.ts), never on Node or library code.
import type { AgentEvent, AgentRun, RouteDecision } from './agent';

/** A user the demo page can act as. Tokens never leave the server. */
export interface DemoUser {
  id: string;
  name: string;
  groups: string[];
}

/** An agent the demo page can ask through. Agent keys never leave the server. */
export interface DemoAgent {
  id: string;
  description: string;
  allowedSources: string[];
  allowedTools: string[];
  /** Users in any of these groups may be sent to this agent by the router. */
  offeredToGroups: string[];
}

/**
 * One server-sent event from GET /api/ask. `type` is also the SSE event name.
 * The stream is: one `routed` (only when the router chose the agent), zero or more agent
 * steps, then exactly one `done` or `error`.
 */
export type AskStreamEvent =
  | ({ type: 'routed' } & RouteDecision)
  | { type: 'step'; event: AgentEvent }
  | { type: 'done'; run: AgentRun }
  | { type: 'error'; message: string };
