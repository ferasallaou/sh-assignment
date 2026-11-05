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
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}
