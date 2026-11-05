import type { ToolSpec } from './models';

/** What the agent needs from the MCP service. The real one talks HTTP (mcp-tool-client.ts). */
export interface AgentToolClient {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, args: unknown): Promise<ToolOutcome>;
}

export interface ToolOutcome {
  isError: boolean;
  /** The tool's output as text (JSON for our tools), or the error message. */
  text: string;
}

/** Each step of a run, reported as it happens (printed by the CLI; can be streamed to a UI). */
export type AgentEvent =
  | { type: 'tool_call'; step: number; name: string; args: unknown }
  | { type: 'tool_result'; step: number; name: string; isError: boolean; recordIds: string[] }
  | { type: 'limit_reached'; reason: 'steps' | 'tool_calls' }
  | { type: 'answer'; text: string };

/** A source the answer cites that the agent really received from a tool during this run. */
export interface Citation {
  externalId: string;
  source: string;
  title: string;
  sourceUpdatedAt: string;
}

export interface AgentRun {
  answer: string;
  /** Cited IDs that came back from a tool, with their details. */
  citations: Citation[];
  /** Cited IDs that never came back from a tool in this run (the model made them up or guessed). */
  unverifiedCitations: string[];
  toolCalls: number;
  /** True if the run hit a step or tool-call limit and had to answer with what it had. */
  stoppedByLimit: boolean;
}

export interface AgentLimits {
  /** Model turns that may call tools before the agent must answer. */
  maxSteps: number;
  /** Tool calls across the whole run. */
  maxToolCalls: number;
}
