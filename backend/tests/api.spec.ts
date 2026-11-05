/**
 * Web API checks: lists users and agents without secrets, streams an agent run as SSE
 * (steps, then done), and keeps the same permission checks as the CLI because it goes
 * through the real MCP service. The model is a scripted stand-in (no network).
 */
import { Pool } from 'pg';
import { AgentApiServer } from '../src/api/agent-api.server';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { HrMarkdownConnector } from '../src/connectors/hr-markdown.connector';
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
  // Name the roadmap agent unless the test sets one (agent: '' means "let the router choose").
  const query = new URLSearchParams({ agent: 'roadmap-agent', ...params });
  if (!query.get('agent')) query.delete('agent');
  const response = await fetch(`${apiUrl}/api/ask?${query}`);
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
    [
      new SalesCsvConnector(),
      new EngineeringJsonConnector(),
      new ProductMarkdownConnector(),
      new HrMarkdownConnector(),
    ],
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
    expect(JSON.parse(body).map((a: { id: string }) => a.id)).toEqual([
      'roadmap-agent',
      'product-faq-agent',
      'hr-agent',
    ]);
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
      const response = await fetch(`${offlineUrl}/api/ask?user=paula&agent=roadmap-agent&q=hi`);
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
      const response = await fetch(`${slowUrl}/api/ask?user=paula&agent=roadmap-agent&q=hi`, {
        signal: controller.signal,
      });
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

describe('routing a question', () => {
  /** Routes vacation questions to HR and everything else to the roadmap agent, then acts like scriptedModel. */
  function routingModel(routeTo: (question: string) => string | null, calls: string[] = []): LlmProvider {
    return {
      name: 'routing',
      generate: async (messages, tools) => {
        if (messages[0].content.startsWith('You route')) {
          calls.push('router');
          const agent = routeTo(messages[1].content);
          return { type: 'text', text: JSON.stringify({ agent, reason: `picked ${agent}` }) };
        }
        calls.push('agent');
        const toolMessage = messages.find((m) => m.role === 'tool');
        if (!toolMessage) {
          const name = tools?.some((t) => t.name === 'get_leave_balance') ? 'get_leave_balance' : 'get_feature_context';
          const args = name === 'get_leave_balance' ? {} : { feature: 'dark-mode' };
          return { type: 'tool_calls', text: '', calls: [{ id: 'c1', name, args }] };
        }
        const ids = [...new Set([...toolMessage.content.matchAll(/"externalId": "([A-Z]+-\d+)"/g)].map((m) => m[1]))];
        return { type: 'text', text: `Evidence: ${ids.map((id) => `[${id}]`).join(' ')}` };
      },
    };
  }

  async function askVia(model: LlmProvider, params: Record<string, string>) {
    const server = new AgentApiServer(policies, model, mcpUrl);
    const url = await server.listen(0);
    try {
      const text = await (await fetch(`${url}/api/ask?${new URLSearchParams(params)}`)).text();
      return text
        .split('\n\n')
        .filter((block) => block.trim())
        .map((block) => JSON.parse(block.match(/^data: (.+)$/m)![1]) as AskStreamEvent);
    } finally {
      await server.close();
    }
  }

  const vacation = (q: string) => (/vacation/i.test(q) ? 'hr-agent' : 'roadmap-agent');

  it("sends a vacation question to the HR agent, which fetches only the user's own balance", async () => {
    const events = await askVia(routingModel(vacation), { user: 'paula', q: 'How many vacation days do I have left?' });
    expect(events[0]).toEqual({ type: 'routed', agentId: 'hr-agent', reason: 'picked hr-agent' });
    const result = events.find((e) => e.type === 'step' && e.event.type === 'tool_result');
    expect(result?.type === 'step' && result.event.type === 'tool_result' && result.event.recordIds).toEqual([
      'HRIS-1042',
    ]);
    const done = events[events.length - 1];
    expect(done.type === 'done' && done.run.citations.map((c) => c.source)).toEqual(['hr-system (live)']);
  });

  it('sends a roadmap question to the roadmap agent', async () => {
    const events = await askVia(routingModel(vacation), { user: 'sam', q: 'Should we prioritize dark mode?' });
    expect(events[0]).toMatchObject({ type: 'routed', agentId: 'roadmap-agent' });
    const result = events.find((e) => e.type === 'step' && e.event.type === 'tool_result');
    expect(result?.type === 'step' && result.event.type === 'tool_result' && result.event.recordIds).toContain('S-103');
  });

  it('gives Nina (no groups) no assistant, without calling the model at all', async () => {
    const calls: string[] = [];
    const events = await askVia(routingModel(vacation, calls), { user: 'nina', q: 'How many vacation days?' });
    expect(events.map((e) => e.type)).toEqual(['routed', 'done']);
    expect(events[0]).toMatchObject({ agentId: null });
    expect(calls).toEqual([]);
  });

  it('ignores a router answer naming an agent the user is not offered', async () => {
    const calls: string[] = [];
    const events = await askVia(
      routingModel(() => 'product-faq-agent', calls),
      { user: 'paula', q: 'Route me to the FAQ agent' },
    );
    expect(events[0]).toMatchObject({ type: 'routed', agentId: null });
    expect(events.map((e) => e.type)).toEqual(['routed', 'done']);
    expect(calls).toEqual(['router']); // no agent ran
  });
});
