/**
 * Steps 12-13 checks: HR policies are synced like any source, but leave balances and salaries
 * are fetched live from the HR web service. Leave is only ever the signed-in user's own; salary
 * access is decided by the MCP service. The roadmap agent can't reach any of it. Uses the real
 * MCP service and HR web service over HTTP, and the MCP SDK client.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Pool } from 'pg';
import { AgentRouter } from '../src/agent/router';
import { EngineeringJsonConnector } from '../src/connectors/engineering-json.connector';
import { HrMarkdownConnector } from '../src/connectors/hr-markdown.connector';
import { ProductMarkdownConnector } from '../src/connectors/product-markdown.connector';
import { SalesCsvConnector } from '../src/connectors/sales-csv.connector';
import { HrApiClient } from '../src/hr/hr-api.client';
import { HrApiServer } from '../src/hr/hr-api.server';
import { DEFAULT_HR_DATA_PATH, HrData } from '../src/hr/hr-data';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';
import { KnowledgeSearchService } from '../src/knowledge/knowledge-search.service';
import { AuditService } from '../src/mcp/audit.service';
import { AGENT_KEY_HEADER, McpService, USER_TOKEN_HEADER } from '../src/mcp/mcp.service';
import { loadPolicyConfig } from '../src/policy/policy-config';
import { SyncService } from '../src/sync/sync.service';
import type { LlmProvider } from '../src/types';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const policies = loadPolicyConfig();
let service: McpService;
let hrApi: HrApiServer;
let url: string;
const SERVICE_KEY = 'test-hr-key';
const openClients: Client[] = [];

const HR = 'dev-agent-hr';
const ROADMAP = 'dev-agent-roadmap';

// The live HR data is a temporary copy, so the "edit, then ask again" test doesn't touch the demo file.
const hrDataPath = join(mkdtempSync(join(tmpdir(), 'hr-')), 'hr-system.json');
copyFileSync(DEFAULT_HR_DATA_PATH, hrDataPath);

async function connect(agentKey: string, user: string): Promise<Client> {
  const token = policies.users.find((u) => u.id === user)!.token;
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { [AGENT_KEY_HEADER]: agentKey, [USER_TOKEN_HEADER]: token } },
  });
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  await client.connect(transport);
  openClients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError === true, text, json: result.isError ? undefined : JSON.parse(text) };
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
  hrApi = new HrApiServer(SERVICE_KEY, new HrData(hrDataPath), 0);
  const hrUrl = await hrApi.listen(0);
  service = new McpService(
    policies,
    catalog,
    new KnowledgeSearchService(pool, null),
    new AuditService(pool),
    new HrApiClient(hrUrl, SERVICE_KEY),
  );
  url = await service.listen(0);
});

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
  await service.close();
  await hrApi.close();
  await pool.end();
});

describe('HR policies (synced)', () => {
  it('reads the HR documents as the hr source, keeping missing-permission rules', async () => {
    const batch = await new HrMarkdownConnector().fetchChanges();
    const records = batch.changes.map((c) => (c.type === 'upsert' ? c.record : null));
    expect(records.map((r) => r?.externalId)).toEqual(['HR-1', 'HR-2']);
    expect(records[0]?.allowedGroups).toEqual(['product', 'sales', 'engineering']);
    expect(new HrMarkdownConnector().sourceName).toBe('hr');
  });

  it('lets the HR agent find the leave policy, but not the HR-only salary bands', async () => {
    const hr = await connect(HR, 'paula');
    const leave = await call(hr, 'search_knowledge', { query: 'vacation days carry over' });
    expect(leave.json.results.map((r: { externalId: string }) => r.externalId)).toContain('HR-1');
    const salary = await call(hr, 'search_knowledge', { query: 'salary bands 2027' });
    expect(salary.text).not.toContain('HR-2');
  });

  it('keeps HR documents out of the roadmap agent, even when asked directly', async () => {
    const roadmap = await connect(ROADMAP, 'paula');
    const { json } = await call(roadmap, 'search_knowledge', { query: 'annual leave policy vacation days' });
    expect(json.results.some((r: { source: string }) => r.source === 'hr')).toBe(false);
  });
});

describe('leave balance (live)', () => {
  it("returns the signed-in user's own balance, worked out from the HR system", async () => {
    const { json } = await call(await connect(HR, 'paula'), 'get_leave_balance');
    expect(json.records).toHaveLength(1);
    expect(json.records[0]).toMatchObject({
      externalId: 'HRIS-1042',
      source: 'hr-system (live)',
      userId: 'paula',
      remainingDays: 10, // 25 - 11 taken - 4 booked
    });
    expect(json.records[0].fetchedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("gives each user their own balance and never accepts someone else's name", async () => {
    const sam = await call(await connect(HR, 'sam'), 'get_leave_balance');
    expect(sam.json.records[0].externalId).toBe('HRIS-1077');
    const attempt = await call(await connect(HR, 'paula'), 'get_leave_balance', { user: 'sam' });
    expect(attempt.isError).toBe(true);
    expect(attempt.text).toMatch(/Invalid arguments/);
    expect(attempt.text).not.toContain('1077');
  });

  it('returns nothing for a user the HR system has no record of', async () => {
    const { json } = await call(await connect(HR, 'nina'), 'get_leave_balance');
    expect(json.records).toEqual([]);
  });

  it('is live: an edit in the HR system shows on the next call, with no sync', async () => {
    const hr = await connect(HR, 'eli');
    expect((await call(hr, 'get_leave_balance')).json.records[0].remainingDays).toBe(10);
    const data = JSON.parse(readFileSync(hrDataPath, 'utf8'));
    data.employees.find((e: { user_id: string }) => e.user_id === 'eli').taken_days = 22;
    writeFileSync(hrDataPath, JSON.stringify(data));
    expect((await call(hr, 'get_leave_balance')).json.records[0].remainingDays).toBe(3);
  });

  it('is not offered to the roadmap agent, and refused if it calls it anyway', async () => {
    const roadmap = await connect(ROADMAP, 'paula');
    expect((await roadmap.listTools()).tools.map((t) => t.name)).not.toContain('get_leave_balance');
    const attempt = await call(roadmap, 'get_leave_balance');
    expect(attempt).toMatchObject({ isError: true, text: 'Unknown tool: get_leave_balance' });
  });

  it('audits the call without storing the balance', async () => {
    await pool.query('TRUNCATE audit_log');
    await call(await connect(HR, 'sam'), 'get_leave_balance');
    const { rows } = await pool.query('SELECT * FROM audit_log');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent_id: 'hr-agent', user_id: 'sam', tool: 'get_leave_balance', result_count: 1 });
    // Only who, what and how many: the row has no column for results, and the arguments are empty.
    expect(Object.keys(rows[0]).sort()).toEqual([
      'agent_id',
      'allowed',
      'arguments',
      'at',
      'id',
      'result_count',
      'tool',
      'user_id',
    ]);
    expect(rows[0].arguments).toEqual({});
  });
});

describe('salary (live, checked by the MCP service)', () => {
  const salaryOf = (result: { json?: { records: { externalId: string; baseSalaryEur: number }[] } }) =>
    result.json?.records[0];

  it("returns the user's own salary", async () => {
    const result = await call(await connect(HR, 'eli'), 'get_salary');
    expect(salaryOf(result)).toMatchObject({ externalId: 'HRIS-1103', baseSalaryEur: 74000 });
  });

  it("refuses an engineer asking for a colleague's salary, and logs the refusal", async () => {
    await pool.query('TRUNCATE audit_log');
    const result = await call(await connect(HR, 'eli'), 'get_salary', { employee: 'Paula' });
    expect(result).toEqual({ isError: true, text: 'Not allowed: you can only see your own salary.', json: undefined });
    const { rows } = await pool.query('SELECT user_id, tool, arguments, allowed FROM audit_log');
    expect(rows).toEqual([{ user_id: 'eli', tool: 'get_salary', arguments: { employee: 'Paula' }, allowed: false }]);
  });

  it('gives the same refusal for a name that matches nobody, so it reveals nothing', async () => {
    const real = await call(await connect(HR, 'eli'), 'get_salary', { employee: 'paula' });
    const fake = await call(await connect(HR, 'eli'), 'get_salary', { employee: 'Bob' });
    expect(fake.text).toBe(real.text);
  });

  it("allows HR to see a colleague's salary", async () => {
    const result = await call(await connect(HR, 'hana'), 'get_salary', { employee: 'Paula' });
    expect(salaryOf(result)).toMatchObject({ externalId: 'HRIS-1042', baseSalaryEur: 70000 });
  });

  it("lets HR see the HR-only salary bands, which staff can't", async () => {
    const hana = await call(await connect(HR, 'hana'), 'search_knowledge', { query: 'salary bands 2027' });
    expect(hana.json.results.map((r: { externalId: string }) => r.externalId)).toContain('HR-2');
  });

  it('is not offered to the roadmap agent', async () => {
    const attempt = await call(await connect(ROADMAP, 'hana'), 'get_salary');
    expect(attempt).toMatchObject({ isError: true, text: 'Unknown tool: get_salary' });
  });
});

describe('HR web service', () => {
  it('rejects callers without the service key', async () => {
    const server = new HrApiServer(SERVICE_KEY, new HrData(hrDataPath), 0);
    const hrUrl = await server.listen(0);
    try {
      expect((await fetch(`${hrUrl}/employees/paula/salary`)).status).toBe(401);
      const wrongKey = await fetch(`${hrUrl}/employees/paula/salary`, { headers: { 'x-hr-service-key': 'guess' } });
      expect(wrongKey.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('fails clearly when the HR system is down', async () => {
    await expect(new HrApiClient('http://127.0.0.1:1', SERVICE_KEY).getSalary('paula')).rejects.toThrow(
      /Is "npm run hr-api" running\?/,
    );
  });
});

describe('router', () => {
  const replying = (text: string, calls: string[] = []): LlmProvider => ({
    name: 'fixed',
    generate: async () => {
      calls.push('called');
      return { type: 'text', text };
    },
  });
  const user = (id: string) => policies.users.find((u) => u.id === id)!;

  it('offers all three agents to staff, only HR to the HR team, and nothing to a user with no groups', () => {
    const router = new AgentRouter(replying(''), policies);
    expect(router.offeredTo(user('eli')).map((a) => a.id)).toEqual(['roadmap-agent', 'product-faq-agent', 'hr-agent']);
    expect(router.offeredTo(user('nina'))).toEqual([]);
    expect(router.offeredTo(user('hana')).map((a) => a.id)).toEqual(['hr-agent']);
  });

  it('accepts a valid choice, even wrapped in extra text', async () => {
    const router = new AgentRouter(replying('Sure: {"agent": "hr-agent", "reason": "leave question"}'), policies);
    expect(await router.route(user('sam'), 'vacation?')).toEqual({ agentId: 'hr-agent', reason: 'leave question' });
  });

  it('treats a broken or unknown answer as "no agent"', async () => {
    for (const text of ['not json', '{"agent": 42}', '{"agent": "admin-agent", "reason": "x"}']) {
      expect((await new AgentRouter(replying(text), policies).route(user('sam'), 'q')).agentId).toBeNull();
    }
  });
});
