/**
 * Starts the pretend HR system as its own web service (port HR_API_PORT, default 3300).
 * The MCP service calls it live for leave balances and salaries. Usage: npm run hr-api
 */
import { loadConfig } from '../src/config';
import { HrApiServer } from '../src/hr/hr-api.server';

async function main(): Promise<void> {
  const config = loadConfig();
  const url = await new HrApiServer(config.HR_SERVICE_KEY).listen(config.HR_API_PORT);
  console.log(`Pretend HR system listening on ${url} (data: backend/data/live/hr-system.json, read on every request)`);
}

main().catch((error) => {
  console.error(`✖ ${(error as Error).message}`);
  process.exit(1);
});
