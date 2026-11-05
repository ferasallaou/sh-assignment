/**
 * Starts the MCP service that agents connect to.
 *
 * Usage: npm run mcp   (listens on MCP_PORT, default 3100)
 * Each request must send the headers x-agent-key and x-user-token (see data/policies.yaml).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config';
import { McpService } from '../src/mcp/mcp.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error', 'warn'] });
  const mcp = app.get(McpService);
  const url = await mcp.listen(loadConfig().MCP_PORT);
  console.log(`MCP service listening on ${url}`);

  const shutdown = async () => {
    await mcp.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
