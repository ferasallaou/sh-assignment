import type { PolicyConfig, ToolName, VerifiedCaller } from '../types';

/**
 * Turns the keys on a request into a verified caller, or null if either key is unknown.
 * Both keys are required: an agent never acts without a user, and a user never calls directly.
 *
 * In production the agent key would be a service credential and the user token a signed
 * token from the company login (SSO), checked by signature instead of a lookup.
 */
export function resolveCaller(
  config: PolicyConfig,
  agentKey: string | undefined,
  userToken: string | undefined,
): VerifiedCaller | null {
  if (!agentKey || !userToken) return null;
  const agent = config.agents.find((a) => a.api_key === agentKey);
  const user = config.users.find((u) => u.token === userToken);
  if (!agent || !user) return null;
  return { agent, user };
}

/** Tools are granted per agent. Checked when listing tools AND again on every call. */
export function canUseTool(caller: VerifiedCaller, tool: string): tool is ToolName {
  return (caller.agent.allowed_tools as string[]).includes(tool);
}
