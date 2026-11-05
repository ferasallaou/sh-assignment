import { z } from 'zod';
import type { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import type { Feature, HrSystem, ToolName, VerifiedCaller } from '../types';

/**
 * The tools the MCP service offers.
 *
 * Inputs are strict: unknown fields are rejected. There is deliberately no field for
 * "user", "groups" or "source", so a model can't ask for someone else's access;
 * identity always comes from the request's verified keys.
 */
const searchInput = z
  .object({
    query: z.string().trim().min(1).max(500).describe('The question or keywords to search for.'),
    limit: z.number().int().min(1).max(10).default(5).describe('How many results to return (1-10).'),
  })
  .strict();

const featureInput = z
  .object({
    feature: z.string().min(1).max(100).describe('The feature key, e.g. "dark-mode".'),
  })
  .strict();

// No fields at all: the balance is always the signed-in user's own, so there is nothing to ask for.
const leaveInput = z.object({}).strict();

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Validates the arguments and runs the tool. Returns the results and how many there were. */
  run(caller: VerifiedCaller, args: unknown): Promise<{ output: unknown; resultCount: number }>;
}

export function buildTools(search: KnowledgeSearchService, catalog: Feature[], hr: HrSystem): ToolDefinition[] {
  const featureList = catalog.map((f) => `${f.key} (${f.name})`).join(', ');
  return [
    {
      name: 'search_knowledge',
      description:
        'Searches company knowledge (sales requests, engineering tickets, product docs) that you and ' +
        'the current user are allowed to see. Returns matching text with its source, ID and last update time.',
      inputSchema: toInputSchema(searchInput),
      async run(caller, args) {
        const { query, limit } = searchInput.parse(args);
        const response = await search.search(caller, query, limit);
        return { output: response, resultCount: response.results.length };
      },
    },
    {
      name: 'get_feature_context',
      description:
        'Returns every record linked to one product feature that you and the current user are allowed ' +
        `to see, with how each record relates to it. Known features: ${featureList}.`,
      inputSchema: toInputSchema(featureInput),
      async run(caller, args) {
        const { feature } = featureInput.parse(args);
        const records = await search.getFeatureContext(caller, feature);
        return { output: { feature, records }, resultCount: records.length };
      },
    },
    {
      name: 'get_leave_balance',
      description:
        "Returns the current user's own leave balance for this year (days left, taken, booked, carried over), " +
        'fetched live from the HR system. Takes no input: it can only return the balance of the user you act ' +
        'for, never anyone else.',
      inputSchema: toInputSchema(leaveInput),
      async run(caller, args) {
        leaveInput.parse(args);
        // The user comes from the verified caller, never from the model.
        const balance = await hr.getLeaveBalance(caller.user.id);
        if (!balance)
          return { output: { records: [], message: 'The HR system has no record for you.' }, resultCount: 0 };
        // Shaped like the other tools' records, so the agent can cite it and the page can show it.
        const record = {
          externalId: `HRIS-${balance.employeeNumber}`,
          source: 'hr-system (live)',
          title: `Leave balance ${balance.year}: ${caller.user.name}`,
          sourceUpdatedAt: balance.updatedAt,
          fetchedAt: new Date().toISOString(),
          ...balance,
        };
        return { output: { records: [record] }, resultCount: 1 };
      },
    },
  ];
}

function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  // The "$schema" line is noise for MCP clients; the rest is plain JSON Schema.
  const { $schema: _unused, ...jsonSchema } = z.toJSONSchema(schema, { io: 'input' });
  return jsonSchema;
}
