/**
 * Web API checks: lists users and agents without secrets, streams an agent run as SSE
 * (steps, then done), and keeps the same permission checks as the CLI because it goes
 * through the real MCP service. The model is a scripted stand-in (no network).
 */
import { Pool } from 'pg';
import { AgentApiServer } from '../src/api/agent-api.server';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { ProductMarkdownConnector } from '../src/connectors/product-markdown.connector';
import { SalesCsvConnector } from '../src/connectors/sales-csv.connector';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';
import { KnowledgeSearchService } from '../src/knowledge/knowledge-search.service';
import { AuditService } from '../src/mcp/audit.service';
import { McpService } from '../src/mcp/mcp.service';
import { loadPolicyConfig } from '../src/policy/policy-config';
import { SyncService } from '../src/sync/sync.service';
import type { AskStreamEvent, LlmProvider } from '../src/types';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const policies = loadPolicyConfig();
let mcp: McpService;
let api: AgentApiServer;
let apiUrl: string;
let mcpUrl: string;

/** Looks up the dark mode feature, then answers citing every record it received. */
const scriptedModel: LlmProvider = {
  name: 'scripted',
  generate: async (messages) => {
    const toolMessage = messages.find((m) => m.role === 'tool');
    if (!toolMessage) {
      return {
        type: 'tool_calls',
        text: '',
        calls: [{ id: 'c1', name: 'get_feature_context', args: { feature: 'dark-mode' } }],
      };
    }
    const ids = [...new Set([...toolMessage.content.matchAll(/"externalId": "([A-Z]+-\d+)"/g)].map((m) => m[1]))];
    return { type: 'text', text: `Evidence: ${ids.map((id) => `[${id}]`).join(' ')}` };
  },
};

/** Reads a whole SSE response and parses its events. */
async function ask(params: Record<string, string>): Promise<{ status: number; events: AskStreamEvent[] }> {
  const response = await fetch(`${apiUrl}/api/ask?${new URLSearchParams(params)}`);
  if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
    return { status: response.status, events: [] };
  }
  const text = await response.text();
  const events = text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const name = block.match(/^event: (.+)$/m)![1];
      const data = JSON.parse(block.match(/^data: (.+)$/m)![1]) as AskStreamEvent;
      expect(data.type).toBe(name); // the SSE event name matches the payload type
      return data;
    });
  return { status: response.status, events };
}

beforeAll(async () => {
  await pool.query('TRUNCATE records, entities, sync_state, audit_log RESTART IDENTITY CASCADE');
  const catalog = loadFeatureCatalog();
  await new SyncService(
    pool,
    [new SalesCsvConnector(), new EngineeringJsonConnector(), new ProductMarkdownConnector()],
    catalog,
    null,
  ).syncAll();
  mcp = new McpService(policies, catalog, new KnowledgeSearchService(pool, null), new AuditService(pool));
  mcpUrl = await mcp.listen(0);
  api = new AgentApiServer(policies, scriptedModel, mcpUrl);
  apiUrl = await api.listen(0);
});

afterAll(async () => {
  await api.close();
  await mcp.close();
  await pool.end();
});

describe('listing users and agents', () => {
  it('lists users without their tokens', async () => {
    const body = await (await fetch(`${apiUrl}/api/users`)).text();
    expect(JSON.parse(body).map((u: { id: string }) => u.id)).toEqual(['paula', 'sam', 'eli', 'nina']);
    expect(body).not.toMatch(/dev-user-|token/);
  });

  it('lists agents without their keys', async () => {
    const body = await (await fetch(`${apiUrl}/api/agents`)).text();
    expect(JSON.parse(body).map((a: { id: string }) => a.id)).toEqual(['roadmap-agent', 'product-faq-agent']);
    expect(body).not.toMatch(/dev-agent-|api_key/);
  });
});

describe('streaming a question', () => {
  it('streams the steps, then one done event with the answer and checked citations', async () => {
    const { events } = await ask({ user: 'paula', q: 'Should we prioritize dark mode next?' });
    expect(events.map((e) => (e.type === 'step' ? `step:${e.event.type}` : e.type))).toEqual([
      'step:tool_call',
      'step:tool_result',
      'step:answer',
      'done',
    ]);
    const done = events[events.length - 1];
    expect(done.type === 'done' && done.run.citations.map((c) => c.externalId)).toContain('ENG-42');
  });

  it('applies the same permissions as the CLI: Paula and Sam get different records', async () => {
    const received = async (user: string) => {
      const { events } = await ask({ user, q: 'dark mode?' });
      const result = events.find((e) => e.type === 'step' && e.event.type === 'tool_result');
      return result?.type === 'step' && result.event.type === 'tool_result' ? result.event.recordIds : [];
    };
    const paula = await received('paula');
    const sam = await received('sam');
    expect(paula).toContain('ENG-42');
    expect(paula).not.toContain('S-103');
    expect(sam).toContain('S-103');
    expect(sam).not.toContain('ENG-42');
  });

  it('asks through the chosen agent, so the narrower agent only gets Product records', async () => {
    const { events } = await ask({ user: 'sam', agent: 'product-faq-agent', q: 'dark mode?' });
    // The FAQ agent isn't given get_feature_context, so the scripted model's call is refused.
    const result = events.find((e) => e.type === 'step' && e.event.type === 'tool_result');
    expect(result?.type === 'step' && result.event.type === 'tool_result' && result.event.isError).toBe(true);
  });

  it('rejects unknown users, unknown agents and empty or long questions', async () => {
    expect((await ask({ user: 'mallory', q: 'hi' })).status).toBe(400);
    expect((await ask({ user: 'paula', agent: 'admin-agent', q: 'hi' })).status).toBe(400);
    expect((await ask({ user: 'paula', q: '  ' })).status).toBe(400);
    expect((await ask({ user: 'paula', q: 'x'.repeat(501) })).status).toBe(400);
  });

  it('ends the stream with a clear error when the MCP service is unreachable', async () => {
    const offline = new AgentApiServer(policies, scriptedModel, 'http://127.0.0.1:1/mcp');
    const offlineUrl = await offline.listen(0);
    try {
      const response = await fetch(`${offlineUrl}/api/ask?user=paula&q=hi`);
      const text = await response.text();
      expect(text).toMatch(/^event: error\n/);
      expect(text).toMatch(/Is \\"npm run mcp\\" running\?/);
    } finally {
      await offline.close();
    }
  });

  it('stops the agent soon after the browser disconnects, so no model calls are wasted', async () => {
    let calls = 0;
    const slowModel: LlmProvider = {
      name: 'slow',
      generate: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          type: 'tool_calls',
          text: '',
          calls: [{ id: `c${calls}`, name: 'search_knowledge', args: { query: 'x' } }],
        };
      },
    };
    const slow = new AgentApiServer(policies, slowModel, mcpUrl);
    const slowUrl = await slow.listen(0);
    try {
      const controller = new AbortController();
      const response = await fetch(`${slowUrl}/api/ask?user=paula&q=hi`, { signal: controller.signal });
      await response.body!.getReader().read(); // the first step arrives
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 600));
      // Left alone it would make 7 calls (6 tool steps and a final answer).
      expect(calls).toBeLessThanOrEqual(2);
    } finally {
      await slow.close();
    }
  });
});
