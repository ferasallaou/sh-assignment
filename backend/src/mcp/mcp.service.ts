import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
// The low-level MCP server is used on purpose: we need to list a different set of tools per
// caller and to audit calls to tools the caller wasn't given. The high-level McpServer
// rejects unknown tools before our code runs, so those attempts would go unrecorded.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, CallToolResult, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { FEATURE_CATALOG } from '../knowledge/knowledge.module';
import { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import { canUseTool, resolveCaller } from '../policy/identity';
import { POLICY_CONFIG } from '../policy/policy.module';
import { HR_SYSTEM } from '../hr/hr.module';
import { HrApiClient } from '../hr/hr-api.client';
import { AccessDeniedError } from '../policy/hr-access';
import { loadConfig } from '../config';
import type { Feature, HrSystem, PolicyConfig, VerifiedCaller } from '../types';
import { AuditService } from './audit.service';
import { buildTools, ToolDefinition } from './tools';

/** Header names for the mock identity keys. Production: a service credential and an SSO token. */
export const AGENT_KEY_HEADER = 'x-agent-key';
export const USER_TOKEN_HEADER = 'x-user-token';
export const MCP_PATH = '/mcp';

/**
 * The one door agents use to reach knowledge, over MCP (Streamable HTTP).
 *
 * Every HTTP request:
 *   1. Resolves the caller from the agent key and user token headers. Unknown → 401.
 *   2. Gets a fresh MCP server bound to that caller (stateless: nothing is shared between requests).
 *   3. Lists only the tools that caller's agent was granted.
 *   4. On every tool call: checks the grant again, validates arguments, runs the tool, audits it.
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly tools: ToolDefinition[];
  private httpServer?: HttpServer;

  constructor(
    @Inject(POLICY_CONFIG) private readonly policies: PolicyConfig,
    @Inject(FEATURE_CATALOG) catalog: Feature[],
    // Explicit @Inject on every parameter: `npm run mcp` runs through tsx, which doesn't emit
    // the type metadata Nest would otherwise use to find class dependencies.
    @Inject(KnowledgeSearchService) search: KnowledgeSearchService,
    @Inject(AuditService) private readonly audit: AuditService,
    // The live HR system. Optional so tests that don't use HR can leave it out.
    @Optional() @Inject(HR_SYSTEM) hr: HrSystem = defaultHrSystem(),
  ) {
    this.tools = buildTools(search, catalog, hr, policies);
  }

  /** Starts the HTTP server. Port 0 picks a free port (used by tests). Returns the URL. */
  async listen(port: number, host = '127.0.0.1'): Promise<string> {
    this.httpServer = createServer((req, res) => {
      this.handleHttp(req, res).catch((error) => {
        this.logger.error(`Request failed: ${(error as Error).message}`);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      });
    });
    await new Promise<void>((resolve) => this.httpServer!.listen(port, host, resolve));
    const address = this.httpServer.address() as AddressInfo;
    return `http://${host}:${address.port}${MCP_PATH}`;
  }

  async close(): Promise<void> {
    if (!this.httpServer) return;
    await new Promise<void>((resolve, reject) => this.httpServer!.close((e) => (e ? reject(e) : resolve())));
    this.httpServer = undefined;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== MCP_PATH) {
      return sendJson(res, 404, { error: 'not found' });
    }
    // Stateless mode: no sessions and no server-to-client stream, so only POST is used.
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    const caller = resolveCaller(this.policies, header(req, AGENT_KEY_HEADER), header(req, USER_TOKEN_HEADER));
    if (!caller) {
      // Same answer for a missing key, an unknown agent key or an unknown user token.
      return sendJson(res, 401, { error: 'unknown or missing agent key or user token' });
    }

    const server = this.serverFor(caller);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  /** An MCP server that only knows this caller. */
  private serverFor(caller: VerifiedCaller): Server {
    const server = new Server({ name: 'company-knowledge', version: '0.1.0' }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools
        .filter((tool) => canUseTool(caller, tool.name))
        .map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema: inputSchema as { type: 'object' },
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.callTool(caller, request.params.name, request.params.arguments ?? {}),
    );

    return server;
  }

  private async callTool(caller: VerifiedCaller, name: string, args: unknown): Promise<CallToolResult> {
    const base = { agentId: caller.agent.id, userId: caller.user.id, tool: name, arguments: args };

    // Checked again here, not only when listing: a client can call a tool it was never shown.
    const tool = this.tools.find((t) => t.name === name);
    if (!tool || !canUseTool(caller, name)) {
      await this.audit.record({ ...base, allowed: false, resultCount: null });
      // Same message whether the tool doesn't exist or isn't granted.
      return errorResult(`Unknown tool: ${name}`);
    }

    try {
      const { output, resultCount } = await tool.run(caller, args);
      await this.audit.record({ ...base, allowed: true, resultCount });
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        // The tool was granted, but this user may not see what they asked for.
        await this.audit.record({ ...base, allowed: false, resultCount: null });
        return errorResult(error.message);
      }
      await this.audit.record({ ...base, allowed: true, resultCount: null });
      if (error instanceof ZodError) {
        const problems = error.issues.map((i) => `${i.path.join('.') || '(arguments)'}: ${i.message}`).join('; ');
        return errorResult(`Invalid arguments: ${problems}`);
      }
      this.logger.error(`Tool ${name} failed: ${(error as Error).message}`);
      return errorResult(`Tool ${name} failed`);
    }
  }
}

function defaultHrSystem(): HrSystem {
  const config = loadConfig();
  return new HrApiClient(config.HR_API_URL ?? `http://127.0.0.1:${config.HR_API_PORT}`, config.HR_SERVICE_KEY);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
