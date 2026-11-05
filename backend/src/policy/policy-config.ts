import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

/** The tools the MCP service offers. Agents may only be granted tools from this list. */
export const TOOL_NAMES = ['search_knowledge', 'get_feature_context', 'get_leave_balance', 'get_salary'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** The sources the knowledge base syncs. Agents may only be scoped to these. */
export const SOURCE_NAMES = ['sales', 'engineering', 'product', 'hr'] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

const agentSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  api_key: z.string().min(1),
  allowed_sources: z.array(z.enum(SOURCE_NAMES)),
  allowed_tools: z.array(z.enum(TOOL_NAMES)),
  // Users in any of these groups may be sent to this agent by the router. Empty: never offered.
  offered_to_groups: z.array(z.string().min(1)).default([]),
});

const userSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  token: z.string().min(1),
  groups: z.array(z.string().min(1)),
});

const policyConfigSchema = z
  .object({
    agents: z.array(agentSchema),
    users: z.array(userSchema),
  })
  .superRefine((config, ctx) => {
    // Every credential must point at exactly one identity, or identity resolution is ambiguous.
    const credentials = [...config.agents.map((agent) => agent.api_key), ...config.users.map((user) => user.token)];
    const duplicates = credentials.filter((value, index) => credentials.indexOf(value) !== index);
    if (duplicates.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Duplicate keys or tokens: ${duplicates.join(', ')}` });
    }
  });

export type AgentPolicy = z.infer<typeof agentSchema>;
export type UserPolicy = z.infer<typeof userSchema>;
export type PolicyConfig = z.infer<typeof policyConfigSchema>;

export const DEFAULT_POLICY_PATH = join(__dirname, '..', '..', 'data', 'policies.yaml');

/** Reads and validates data/policies.yaml. Throws with a clear message if anything is wrong. */
export function loadPolicyConfig(path: string = DEFAULT_POLICY_PATH): PolicyConfig {
  return parsePolicyConfig(readFileSync(path, 'utf8'));
}

export function parsePolicyConfig(yamlText: string): PolicyConfig {
  const result = policyConfigSchema.safeParse(parse(yamlText));
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid policies.yaml:\n${problems}`);
  }
  return result.data;
}
