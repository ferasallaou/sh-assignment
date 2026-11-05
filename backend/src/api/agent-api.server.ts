import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { McpToolClient } from '../agent/mcp-tool-client';
import { AgentLoop } from '../agent/agent-loop';
import { instructionsFor } from '../agent/instructions';
import { AgentRouter } from '../agent/router';
import type { AgentEvent, AgentPolicy, AskStreamEvent, DemoAgent, DemoUser, LlmProvider, PolicyConfig } from '../types';

const MAX_QUESTION_LENGTH = 500;

/**
 * A small HTTP API for the web page. It picks an agent with the router (unless one is named),
 * runs it on the server and streams each step to the browser with server-sent events (SSE).
 *
 *   GET /api/users    users the demo page can act as (no tokens)
 *   GET /api/agents   agents the demo page can ask through (no keys)
 *   GET /api/ask?user=paula&q=...   SSE stream of AskStreamEvent (add &agent=<id> to skip the router)
 *
 * The agent here is a normal MCP client, exactly like the CLI: it connects to the MCP
 * service with the agent's key and the user's token, so the same permission checks apply.
 *
 * Demo shortcut: the browser picks the user by ID. In production the user would come
 * from the company login (a session or token), never from a query parameter.
 */
export class AgentApiServer {
  private httpServer?: HttpServer;
  private readonly router: AgentRouter;

  constructor(
    private readonly policies: PolicyConfig,
    private readonly llm: LlmProvider,
    private readonly mcpUrl: string,
  ) {
    this.router = new AgentRouter(llm, policies);
  }

  async listen(port: number, host = '127.0.0.1'): Promise<string> {
    this.httpServer = createServer((req, res) => {
      this.route(req, res).catch((error) => {
        if (!res.headersSent) sendJson(res, 500, { error: (error as Error).message });
        else res.end();
      });
    });
    await new Promise<void>((resolve) => this.httpServer!.listen(port, host, resolve));
    return `http://${host}:${(this.httpServer.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    if (!this.httpServer) return;
    this.httpServer.closeAllConnections();
    await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    this.httpServer = undefined;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

    if (url.pathname === '/api/users') {
      const users: DemoUser[] = this.policies.users.map(({ id, name, groups }) => ({ id, name, groups }));
      return sendJson(res, 200, users);
    }
    if (url.pathname === '/api/agents') {
      const agents: DemoAgent[] = this.policies.agents.map((a) => ({
        id: a.id,
        description: a.description,
        allowedSources: a.allowed_sources,
        allowedTools: a.allowed_tools,
        offeredToGroups: a.offered_to_groups,
      }));
      return sendJson(res, 200, agents);
    }
    if (url.pathname === '/api/ask') return this.ask(url, res);
    return sendJson(res, 404, { error: 'not found' });
  }

  private async ask(url: URL, res: ServerResponse): Promise<void> {
    const user = this.policies.users.find((u) => u.id === url.searchParams.get('user'));
    const agentId = url.searchParams.get('agent');
    const named = agentId ? this.policies.agents.find((a) => a.id === agentId) : undefined;
    const question = (url.searchParams.get('q') ?? '').trim();
    if (!user || (agentId && !named)) return sendJson(res, 400, { error: 'unknown user or agent' });
    if (!question || question.length > MAX_QUESTION_LENGTH) {
      return sendJson(res, 400, { error: `question must be 1-${MAX_QUESTION_LENGTH} characters` });
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    let open = true;
    res.on('close', () => (open = false));
    const send = (event: AskStreamEvent) => {
      if (open) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    // If the browser leaves (closed tab, new question), stop at the next step instead of
    // spending more model calls on an answer nobody will read.
    const onStep = (event: AgentEvent) => {
      if (!open) throw new ClientLeftError();
      send({ type: 'step', event });
    };

    let tools: McpToolClient | undefined;
    try {
      let agent: AgentPolicy | undefined = named;
      if (!agent) {
        const decision = await this.router.route(user, question);
        send({ type: 'routed', ...decision });
        agent = this.policies.agents.find((a) => a.id === decision.agentId);
        if (!agent) {
          // Nothing to run: answer with the router's reason.
          const run = {
            answer: decision.reason,
            citations: [],
            unverifiedCitations: [],
            toolCalls: 0,
            stoppedByLimit: false,
          };
          return send({ type: 'done', run });
        }
      }
      tools = await McpToolClient.connect(this.mcpUrl, agent.api_key, user.token);
      const run = await new AgentLoop(this.llm, tools, undefined, onStep, instructionsFor(agent.id)).ask(question);
      send({ type: 'done', run });
    } catch (error) {
      if (error instanceof ClientLeftError) return;
      send({ type: 'error', message: friendlyError(error as Error, this.mcpUrl) });
    } finally {
      await tools?.close().catch(() => {});
      res.end();
    }
  }
}

class ClientLeftError extends Error {}

function friendlyError(error: Error, mcpUrl: string): string {
  if (/fetch failed|ECONNREFUSED/i.test(error.message)) {
    return `Could not reach the MCP service at ${mcpUrl}. Is "npm run mcp" running?`;
  }
  return error.message;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
