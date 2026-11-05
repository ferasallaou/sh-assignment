import { createHash, timingSafeEqual } from 'node:crypto';
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
  const agent = config.agents.find((a) => sameSecret(a.api_key, agentKey));
  const user = config.users.find((u) => sameSecret(u.token, userToken));
  if (!agent || !user) return null;
  return { agent, user };
}

/** Tools are granted per agent. Checked when listing tools AND again on every call. */
export function canUseTool(caller: VerifiedCaller, tool: string): tool is ToolName {
  return (caller.agent.allowed_tools as string[]).includes(tool);
}

/**
 * Compares two secrets in constant time, so response timing gives no hint of how much of a
 * guessed key was right. Hashing first gives both sides the same length, which timingSafeEqual needs.
 */
function sameSecret(expected: string, given: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(expected), digest(given));
}
