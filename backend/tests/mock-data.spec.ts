/**
 * Step 2 checks: the mock identities and the feature catalog are valid,
 * and the mock data contains the cases the demo scenarios depend on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPolicyConfig, parsePolicyConfig } from '../src/policy/policy-config';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';

const SOURCES_DIR = join(__dirname, '..', 'data', 'sources');

describe('policies.yaml', () => {
  const config = loadPolicyConfig();

  it('defines the roadmap agent with access to all three sources and both tools', () => {
    const roadmap = config.agents.find((agent) => agent.id === 'roadmap-agent');
    expect(roadmap?.allowed_sources).toEqual(['sales', 'engineering', 'product']);
    expect(roadmap?.allowed_tools).toEqual(['search_knowledge', 'get_feature_context']);
  });

  it('defines a Product user and a Sales user with different groups', () => {
    const groupsOf = (id: string) => config.users.find((user) => user.id === id)?.groups;
    expect(groupsOf('paula')).toEqual(['product']);
    expect(groupsOf('sam')).toEqual(['sales']);
    expect(groupsOf('eli')).toEqual(['engineering']);
    expect(groupsOf('nina')).toEqual([]);
  });

  it('rejects duplicate credentials', () => {
    const yaml = `
agents:
  - { id: a, description: x, api_key: same, allowed_sources: [], allowed_tools: [] }
users:
  - { id: u, name: x, token: same, groups: [] }
`;
    expect(() => parsePolicyConfig(yaml)).toThrow(/Duplicate keys or tokens: same/);
  });

  it('rejects tools the MCP service does not offer', () => {
    const yaml = `
agents:
  - { id: a, description: x, api_key: k, allowed_sources: [], allowed_tools: [delete_everything] }
users: []
`;
    expect(() => parsePolicyConfig(yaml)).toThrow(/allowed_tools/);
  });
});

describe('features.yaml', () => {
  it('lists dark mode with its aliases', () => {
    const darkMode = loadFeatureCatalog().find((feature) => feature.key === 'dark-mode');
    expect(darkMode?.aliases).toEqual(expect.arrayContaining(['dark theme', 'night mode']));
  });
});

describe('mock source data covers the demo scenarios', () => {
  const tickets = JSON.parse(readFileSync(join(SOURCES_DIR, 'engineering', 'tickets.json'), 'utf8'));
  const salesCsv = readFileSync(join(SOURCES_DIR, 'sales', 'feature_requests.csv'), 'utf8');

  it('has an engineering ticket with no permissions (deny-by-default case)', () => {
    expect(tickets.some((ticket: { allowed_groups?: unknown }) => ticket.allowed_groups === undefined)).toBe(true);
  });

  it('has a sales-only record (different-users case)', () => {
    expect(salesCsv).toMatch(/S-103,.*,sales,/);
  });

  it('has records linked only by alias, not by ID (alias-linking case)', () => {
    expect(salesCsv).toMatch(/S-102,Esselunga,,.*night mode/);
    expect(tickets.find((ticket: { id: string }) => ticket.id === 'ENG-43')?.feature).toBeNull();
  });

  it('has a document with an embedded instruction (prompt-injection case)', () => {
    const digest = readFileSync(join(SOURCES_DIR, 'product', 'customer-feedback-digest.md'), 'utf8');
    expect(digest).toMatch(/Ignore all previous instructions/);
  });
});
