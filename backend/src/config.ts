import 'dotenv/config';
import { z } from 'zod';

/**
 * All settings come from environment variables (see .env.example).
 * They are checked once at startup so a bad setup fails fast with a clear message
 * instead of failing later in the middle of a sync or a request.
 */
const configSchema = z.object({
  DATABASE_URL: z.string().url().default('postgres://knowledge:knowledge@localhost:5433/knowledge'),
  MCP_PORT: z.coerce.number().int().min(0).max(65535).default(3100),
  // The agent CLI: which agent key it uses and where the MCP service is (default: localhost on MCP_PORT).
  AGENT_KEY: z.preprocess(emptyToUndefined, z.string().min(1).default('dev-agent-roadmap')),
  MCP_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  // AI models through OpenRouter. With no key, there is no chat model and search uses keywords only.
  // An empty value counts as "not set", so a blank line in .env doesn't break startup.
  OPENROUTER_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  OPENROUTER_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default('https://openrouter.ai/api/v1')),
  OPENROUTER_CHAT_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('anthropic/claude-sonnet-5.5')),
  OPENROUTER_EMBEDDING_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default('openai/text-embedding-3-small'),
  ),
});

function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}
