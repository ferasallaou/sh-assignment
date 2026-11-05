/**
 * Step 6 checks: the MCP service resolves identity from request keys, shows each agent only
 * its own tools, re-checks every call, never lets tool arguments change identity, and audits
 * every call. Starts the real HTTP service and connects with the MCP SDK client.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Pool } from 'pg';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { ProductMarkdownConnector } from '../src/connectors/product-markdown.connector';
import { SalesCsvConnector } from '../src/connectors/sales-csv.connector';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';
import { KnowledgeSearchService } from '../src/knowledge/knowledge-search.service';
import { AuditService } from '../src/mcp/audit.service';
import { AGENT_KEY_HEADER, McpService, USER_TOKEN_HEADER } from '../src/mcp/mcp.service';
import { loadPolicyConfig } from '../src/policy/policy-config';
import { SyncService } from '../src/sync/sync.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let service: McpService;
let url: string;
const openClients: Client[] = [];

const ROADMAP = 'dev-agent-roadmap';
const FAQ = 'dev-agent-product-faq';
const PAULA = 'dev-user-paula';
const SAM = 'dev-user-sam';

async function connect(agentKey: string, userToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { [AGENT_KEY_HEADER]: agentKey, [USER_TOKEN_HEADER]: userToken } },
  });
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  await client.connect(transport);
  openClients.push(client);
  return client;
}

/** Calls a tool and returns its parsed JSON output (or the error text). */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError === true, text, json: result.isError ? undefined : JSON.parse(text) };
}

const recordIds = (records: { externalId: string }[]) => records.map((r) => r.externalId).sort();

async function auditRows() {
  const { rows } = await pool.query(
    'SELECT agent_id, user_id, tool, arguments, allowed, result_count FROM audit_log ORDER BY id',
  );
  return rows;
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

  service = new McpService(loadPolicyConfig(), catalog, new KnowledgeSearchService(pool, null), new AuditService(pool));
  url = await service.listen(0);
});

beforeEach(() => pool.query('TRUNCATE audit_log RESTART IDENTITY'));

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
  await service.close();
  await pool.end();
});

describe('identity', () => {
  async function post(headers: Record<string, string>) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
  }

  it('rejects requests with missing or unknown keys, with the same answer', async () => {
    const responses = await Promise.all([
      post({}),
      post({ [AGENT_KEY_HEADER]: ROADMAP }),
      post({ [AGENT_KEY_HEADER]: 'stolen-key', [USER_TOKEN_HEADER]: PAULA }),
      post({ [AGENT_KEY_HEADER]: ROADMAP, [USER_TOKEN_HEADER]: 'dev-user-nobody' }),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.text()));
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(new Set(bodies).size).toBe(1);
  });

  it('does not let a user key act as an agent key', async () => {
    const response = await post({ [AGENT_KEY_HEADER]: PAULA, [USER_TOKEN_HEADER]: PAULA });
    expect(response.status).toBe(401);
  });

  it('rejects tool arguments that try to switch user or widen access', async () => {
    const paula = await connect(ROADMAP, PAULA);
    const attempt = await call(paula, 'get_feature_context', { feature: 'dark-mode', user: 'sam', groups: ['sales'] });
    expect(attempt.isError).toBe(true);
    expect(attempt.text).toMatch(/Invalid arguments/);

    // And her normal answer still never includes Sam's sales-only record.
    const normal = await call(paula, 'get_feature_context', { feature: 'dark-mode' });
    expect(recordIds(normal.json.records)).not.toContain('S-103');
  });
});

describe('tool visibility', () => {
  it('shows the roadmap agent both tools', async () => {
    const { tools } = await (await connect(ROADMAP, PAULA)).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_feature_context', 'search_knowledge']);
  });

  it('shows the narrower FAQ agent only search', async () => {
    const { tools } = await (await connect(FAQ, PAULA)).listTools();
    expect(tools.map((t) => t.name)).toEqual(['search_knowledge']);
  });

  it('describes tool inputs, with no field for identity', async () => {
    const { tools } = await (await connect(ROADMAP, PAULA)).listTools();
    const search = tools.find((t) => t.name === 'search_knowledge')!;
    expect(Object.keys(search.inputSchema.properties ?? {}).sort()).toEqual(['limit', 'query']);
    expect(search.inputSchema.required).toEqual(['query']);
  });

  it('re-checks on call: a hidden tool is refused, looks like an unknown tool, and is audited', async () => {
    const faq = await connect(FAQ, PAULA);
    const hidden = await call(faq, 'get_feature_context', { feature: 'dark-mode' });
    const unknown = await call(faq, 'delete_everything', {});
    expect(hidden).toEqual({ isError: true, text: 'Unknown tool: get_feature_context', json: undefined });
    expect(unknown.text).toBe('Unknown tool: delete_everything');

    const rows = await auditRows();
    expect(rows.map((r) => [r.agent_id, r.tool, r.allowed, r.result_count])).toEqual([
      ['product-faq-agent', 'get_feature_context', false, null],
      ['product-faq-agent', 'delete_everything', false, null],
    ]);
  });
});

describe('results through the service', () => {
  it('gives Paula and Sam different answers to the same question', async () => {
    const paula = await call(await connect(ROADMAP, PAULA), 'get_feature_context', { feature: 'dark-mode' });
    const sam = await call(await connect(ROADMAP, SAM), 'get_feature_context', { feature: 'dark-mode' });
    expect(recordIds(paula.json.records)).toEqual(['ENG-42', 'ENG-43', 'PRD-11', 'PRD-7', 'PRD-9', 'S-101', 'S-102']);
    expect(recordIds(sam.json.records)).toEqual(['PRD-11', 'PRD-7', 'S-101', 'S-102', 'S-103']);
  });

  it('returns source and update time with every result', async () => {
    const paula = await connect(ROADMAP, PAULA);
    const { json } = await call(paula, 'search_knowledge', { query: 'dark mode', limit: 3 });
    expect(json.results).toHaveLength(3);
    for (const result of json.results) {
      expect(result).toEqual(
        expect.objectContaining({
          source: expect.any(String),
          externalId: expect.any(String),
          sourceUpdatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        }),
      );
    }
  });

  it('keeps the FAQ agent inside Product docs, even for a Sales user', async () => {
    const { json } = await call(await connect(FAQ, SAM), 'search_knowledge', { query: 'dark mode', limit: 10 });
    expect(json.results.length).toBeGreaterThan(0);
    expect(json.results.every((r: { source: string }) => r.source === 'product')).toBe(true);
  });

  it('never returns the record with missing permissions', async () => {
    const paula = await connect(ROADMAP, PAULA);
    const sso = await call(paula, 'get_feature_context', { feature: 'sso' });
    const search = await call(paula, 'search_knowledge', { query: 'SAML login identity provider', limit: 10 });
    expect(recordIds(sso.json.records)).not.toContain('ENG-60');
    expect(recordIds(search.json.results)).not.toContain('ENG-60');
  });

  it('reports invalid arguments clearly', async () => {
    const paula = await connect(ROADMAP, PAULA);
    const result = await call(paula, 'search_knowledge', { query: '', limit: 50 });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Invalid arguments: .*query.*limit/);
  });
});

describe('audit log', () => {
  it('records every call with who asked, for whom, the arguments and how many results', async () => {
    const paula = await connect(ROADMAP, PAULA);
    await call(paula, 'search_knowledge', { query: 'dark mode', limit: 2 });
    await call(paula, 'get_feature_context', { feature: 'no-such-feature' });

    expect(await auditRows()).toEqual([
      {
        agent_id: 'roadmap-agent',
        user_id: 'paula',
        tool: 'search_knowledge',
        arguments: { query: 'dark mode', limit: 2 },
        allowed: true,
        result_count: 2,
      },
      {
        agent_id: 'roadmap-agent',
        user_id: 'paula',
        tool: 'get_feature_context',
        arguments: { feature: 'no-such-feature' },
        allowed: true,
        result_count: 0,
      },
    ]);
  });
});

describe('started with npm run mcp', () => {
  // The tests above build the service by hand. This one starts it the way a user does (through
  // tsx and Nest), which caught a real bug: tsx doesn't emit the type metadata Nest uses to
  // inject class dependencies, so every dependency needs an explicit @Inject.
  it('boots and answers a tool call', async () => {
    const root = join(__dirname, '..');
    // tsx is installed at the workspace root, so resolve it instead of assuming a path.
    const child = spawn(process.execPath, [require.resolve('tsx/cli'), 'scripts/mcp.ts'], {
      cwd: root,
      // No model key: this test must not call OpenRouter (and CI has no key anyway).
      env: { ...process.env, MCP_PORT: '0', OPENROUTER_API_KEY: '' },
    });
    try {
      const startedUrl = await new Promise<string>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`service did not start:\n${output}`)), 15000);
        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          const match = output.match(/listening on (http:\S+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', (code) => reject(new Error(`service exited with ${code}:\n${output}`)));
      });

      const transport = new StreamableHTTPClientTransport(new URL(startedUrl), {
        requestInit: { headers: { [AGENT_KEY_HEADER]: ROADMAP, [USER_TOKEN_HEADER]: SAM } },
      });
      const client = new Client({ name: 'smoke-test', version: '0.0.0' });
      await client.connect(transport);
      openClients.push(client);
      const result = await call(client, 'get_feature_context', { feature: 'dark-mode' });
      expect(recordIds(result.json.records)).toContain('S-103');
    } finally {
      child.kill();
    }
  }, 20000);
});
