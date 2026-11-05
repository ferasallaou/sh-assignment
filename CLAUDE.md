# Company Knowledge Layer PoC

## Project context

This repository is for a ShopFully & Flipp AI Engineer take-home assignment.

The assignment is to design a production-grade knowledge base system for AI agents. The system must:

- Handle distributed sources with different formats, access methods, and owners
- Transform source data into knowledge agents can use
- Expose knowledge through a consistent access layer
- Maintain itself as records are added, changed, or deleted

The two deliverables are:

1. A production design document
2. A lightweight working PoC for one use case

Expected effort for the whole assignment is 4-6 hours. Keep the PoC small and focused on the knowledge layer.

## What we are building

Build a small roadmap vertical slice, not a full roadmap product.

The demo should answer questions such as:

> Should we prioritize dark mode next?

It should combine mocked Sales, Engineering, and Product data while showing that the knowledge is linked, current, and permission-controlled.

## Agreed architecture

```text
Roadmap agent CLI
       │
       ▼
   MCP service
 identity, policy, retrieval, audit
       │
       ▼
  Knowledge base
       ▲
       │
Sync and processing pipeline
       ▲
       │
    Connectors
       ▲
       │
Sales CSV · Engineering JSON · Product Markdown
```

## Core rules

- Enforce permissions outside the LLM. Restricted data must never reach the agent.
- Deny by default. If permissions are missing or unknown, return no data.
- Keep identity from verified caller context, not model-generated tool input.
- Ingest by default. Highly sensitive or rapidly changing data would use live access in production.
- Use one shared knowledge base and one shared MCP service.
- Keep LLM and embedding providers behind internal interfaces.
- Use LangChain only as a provider adapter. Do not put LangChain chains, agents, or retrievers in core business logic.
- Keep retrieval, permissions, and sync logic explicit and easy to read.

## PoC stack

- **Language and framework:** TypeScript and NestJS
- **Models:** OpenRouter, with the chat model and the embedding model set through environment variables (`OPENROUTER_API_KEY`, the user has one)
- **LLM adapter:** LangChain.js behind `LlmProvider`. The model picks tools through LangChain's tool binding, but the agent loop itself is our own small, readable code that runs each tool call through the MCP service.
- **Embeddings:** OpenRouter embeddings behind `EmbeddingProvider`
- **Storage (confirmed):** PostgreSQL with pgvector, run through `docker compose`. Keyword search uses PostgreSQL full-text search, and meaning search uses pgvector, combined in one SQL query together with the permission filter. Each record's change (text, chunks, vectors, permissions, links) is applied in one transaction.
- **Agent access:** MCP TypeScript SDK over HTTP (Streamable HTTP), so every request carries the mock agent and user keys and the service resolves identity
- **Validation:** Zod
- **Testing:** Jest with ts-jest
- **Repo layout (2026-11-05):** npm workspaces. `backend/` holds the knowledge layer (all code, data, migrations, tests and its own `package.json`, `.env` and `tsconfig`). `frontend/` holds the web page (React + Vite). The root `package.json` holds shared tools (ESLint, Prettier) and forwards every command to the backend (`npm run sync` = `npm run sync -w backend`), so all commands still run from the root. `docker-compose.yml`, `docs/` and the planning files stay at the root. One `package-lock.json` at the root.
- **Lint and CI:** ESLint (recommended JS and TypeScript rules) plus Prettier (single quotes, trailing commas, width 120; Markdown docs and `backend/data/sources/` are excluded). Run `npm run check` (lint, format check, types) and `npm test` before pushing. GitHub Actions (`.github/workflows/ci.yml`) runs both on every PR, with a pgvector Postgres service for the tests. Use `npm run format` to fix formatting.
- **Pinned versions (deliberate):** TypeScript `~5.9` (TypeScript 7 breaks ts-jest), NestJS `^11` (NestJS 12 is ESM-only and won't load under the Jest/CommonJS setup). Don't upgrade these without checking the tests still run.
- **Sync behaviour (step 4, `backend/src/sync/sync.service.ts`, run with `npm run sync`):** each record is applied in one transaction. There are two fingerprints per record: `content_hash` (text, so re-chunk and re-embed) and `record_hash` (everything). A permission-only change updates the record without re-chunking. Unchanged snapshots are skipped by cursor. One failing source doesn't stop the others, and its cursor isn't saved, so it retries next run. An empty snapshot never wipes a source that has records. Embeddings are filled after the record transactions for any chunk with a NULL embedding; with no provider they wait, and are filled on a later sync.
- **Search (step 5, `backend/src/knowledge/knowledge-search.service.ts`):** `search` (question) and `getFeatureContext` (feature key) take a `VerifiedCaller` (agent + user, `backend/src/policy/caller.ts`). One SQL condition is used everywhere: the record's source is in the agent's scope AND its groups overlap the user's groups; NULL groups never match. Search merges keyword ranking (full-text, any of the words) and meaning ranking (pgvector) with reciprocal rank fusion, one result per record. With no embedding provider, or if it fails, search falls back to keywords only. Restricted and missing give the same empty answer, with no counts.
- **MCP service (step 6, `backend/src/mcp/`, run with `npm run mcp`, port `MCP_PORT`, default 3100):** stateless Streamable HTTP at `/mcp`, POST only. Each request sends `x-agent-key` and `x-user-token`; both must match `policies.yaml` or the answer is 401, the same for every kind of bad key. A fresh MCP server is built per request for that caller, using the SDK's low-level `Server` (so tool listing is per caller and calls to hidden tools can be audited). Every call re-checks the agent's tools; a hidden tool and a non-existent one give the same "Unknown tool" error. Tool inputs are strict and have no identity fields. Every call, allowed or not, goes to `audit_log`. MCP SDK is `@modelcontextprotocol/sdk` 1.x (the `latest` tag; the split 2.x packages were not used).
- **Shared types live in `backend/src/types/`** (added 2026-11-05). Types used by more than one module (sources, access, knowledge, models, sync) go there and are imported with `import type { ... } from '../types'` (the `index.ts` re-exports everything). The folder holds types only; ESLint rejects functions, classes, constants, enums and value imports or exports there. Types defined by a Zod schema stay next to the schema and are re-exported from `backend/src/types`. Types used by a single file (database row shapes, options for one class) stay in that file. A Nest CLI library was considered and rejected for now: it needs Nest's monorepo layout (`apps/`, `libs/`, path aliases for Jest and tsx) for no gain with one program. It becomes worth it when production splits into several programs (API and sync worker).
- **Nest injection rule:** always use explicit `@Inject(...)` on constructor parameters. Scripts run through tsx, which doesn't emit decorator type metadata, so class-typed injection silently gives `undefined`.
- **AI models (step 7, `backend/src/providers/`):** `OpenRouterChatProvider` (LangChain `ChatOpenAI` pointed at OpenRouter, temperature 0, tools bound in the OpenAI function format) behind `LlmProvider`, and `OpenRouterEmbeddingProvider` (LangChain `OpenAIEmbeddings`) behind `EmbeddingProvider`. Defaults: chat `anthropic/claude-sonnet-5.5`, embeddings `openai/text-embedding-3-small` (1536 numbers); change with `OPENROUTER_CHAT_MODEL` / `OPENROUTER_EMBEDDING_MODEL`. Both are `null` without `OPENROUTER_API_KEY` (a blank value counts as unset). `LlmReply` for tool calls also carries any text the model wrote. Each chunk stores `embedding_model`; sync re-embeds chunks from a different model, and search only compares with vectors from the current model, so switching models is safe. Tests never call OpenRouter (stand-ins replace the LangChain models); `npm run models:check` calls the real models once.
- **Agent loop (step 8, `backend/src/agent/agent-loop.ts`, run with `npm run agent -- --user paula "question"`):** `AgentLoop` (named `RoadmapAgent` before step 12) is our own loop, shared by every agent; only the instructions differ (`instructions.ts`, picked by agent ID): ask the model with the tools the MCP service lists → run each requested call through `McpToolClient` (HTTP, agent key from `AGENT_KEY`, user token from `--user` via `policies.yaml` or `--token`) → repeat → answer. Limits: 6 model turns and 10 tool calls (`DEFAULT_LIMITS`); on a limit, one last turn with no tools forces an answer. Every requested call gets a reply message, even over the limit. Tool results go back wrapped in `<tool_result>` and marked as data. The answer must cite record IDs like `[S-101]`; cited IDs a tool returned become `citations` (with source and update time), others are reported as `unverifiedCitations`. Each step is reported as an `AgentEvent` (for the CLI now, and the optional SSE page later). The CLI needs `npm run mcp` running.
- **Evaluation and demo (step 9):** `backend/data/eval/retrieval.yaml` (10 cases: expected IDs in the top 5, forbidden IDs that must never appear, `needs_meaning` for cases only embeddings can find) and `backend/data/eval/answers.yaml` (3 real-agent cases checking citations and forbidden details, not wording). `npm run eval` scores keyword search, and also keyword + meaning when a key is set; `-- --answers` runs the real agent. Any leak is a failure whatever the scores. `backend/tests/eval.spec.ts` runs the retrieval set in CI (keyword mode). `npm run demo` runs the 6 required scenarios with ✔/✖ checks on a temporary copy of `backend/data/sources` and its own database (`knowledge_demo`), with the real agent if a key is set or tool lookups if not. `docs/demo-run.txt` is a saved real run. `ensureDatabase()` in `backend/scripts/migrate.ts` creates and migrates the test and demo databases.
- **Web page (step 11, `npm run dev` starts MCP + API + page):** `backend/src/api/agent-api.server.ts` is a plain Node HTTP server (port `API_PORT`, default 3200): `GET /api/users` and `/api/agents` (no tokens or keys), and `GET /api/ask?user&agent&q` streaming SSE events (`step` per `AgentEvent`, then one `done` with the `AgentRun` or one `error`). Without `agent` it asks the router first and streams a `routed` event. It runs `AgentLoop` through `McpToolClient` with the chosen user's token, so permissions are the same as the CLI. If the browser disconnects, the agent stops at its next step. `frontend/` is React 19 + Vite; Vite proxies `/api` to the API. The frontend imports API types straight from specific files in `backend/src/types/` (`api.ts`, `agent.ts`), never the index, which pulls in Node and Zod.
- **Router and HR agent (step 12, decisions in `DECISIONS.md`):** `AgentRouter` (`backend/src/agent/router.ts`) makes one model call that picks an agent ID from the agents offered to the user (`offered_to_groups` in `policies.yaml`), as JSON checked with Zod; anything invalid or not offered means no agent. No offered agents means no model call. The router has no key or data access. HR policy documents are a fourth synced source, `hr` (`HrMarkdownConnector`, sharing `MarkdownDocsConnector` with Product). Leave balances and salaries are live (step 13): the pretend HR system is its own web service (`backend/src/hr/hr-api.server.ts`, `npm run hr-api`, port `HR_API_PORT` 3300, service key header `x-hr-service-key`, reads `backend/data/live/hr-system.json` on every request). The MCP service reaches it through the `HrSystem` interface (`HrApiClient`); nothing is stored. `get_leave_balance` takes no input (own balance only). `get_salary` takes an optional `employee` name; the MCP service decides with `canSeeSalaryOf` (`backend/src/policy/hr-access.ts`: own pay, or anyone's for the `hr` group) and throws `AccessDeniedError`, which is audited with `allowed = false` and one fixed refusal message for unknown and forbidden names alike. `npm run dev` starts hr-api, mcp, api and web; `npm run start` first runs db:up, db:migrate and sync, then starts the same four and opens the page. Its record ID is `HRIS-<employee number>`, source `hr-system (live)`. `hr-agent` has sources `[hr]` and tools `search_knowledge`, `get_leave_balance`, `get_salary`. Hana (`hr` group) is the HR user.
- **Tests use a separate database** (`knowledge_test`, created and migrated by `backend/tests/global-setup.ts`), so `npm test` never touches the demo data.
- **Schema notes:** permissions live only on `records`; chunks inherit them by joining back to their record. The `embedding` column has no fixed dimension so the model can change, which means exact vector search with no approximate index (fine at PoC size).

PostgreSQL + pgvector replaced the earlier SQLite assumption at the user's request. Running the demo needs Docker. The knowledge model is confirmed as below. If the implementation reveals a better lightweight choice, explain the tradeoff before changing it.

## Scope

### Build

1. Three mocked sources:
   - Sales as CSV
   - Engineering tickets as JSON
   - Product documents as Markdown
2. Sync connectors using one shared interface
3. A sync process that detects additions, edits, and deletions
4. A knowledge store with records, chunks, entities, and links
5. Permission metadata stored with records and inherited by chunks
6. A permission-aware MCP service
7. A small roadmap agent CLI
8. Tests and a small evaluation set

### Mock or leave out

- Real Salesforce, Jira, Notion, or HR integrations
- Real SSO or OAuth
- Kafka, distributed workers, and multi-region infrastructure
- Polished UI (a small, plain web page that streams the agent's steps over SSE is allowed as optional step 11, after the core proof)
- Multi-agent router
- LLM-based entity matching

Mention production replacements in the design document or README, but do not build them.

## Module structure (as built)

```text
backend/
  src/
    connectors/  sync/  knowledge/  mcp/  policy/  providers/  agent/  api/  eval/  types/
  data/
    sources/  eval/  features.yaml  policies.yaml
  db/migrations/
  scripts/
  tests/
frontend/
  src/  (App, RunPanel, Answer, run state and the SSE hook)
docs/
  design.md  ai-sdlc.md  demo-run.txt
```

## Key interfaces

```ts
// As built in src/types/sources.ts (moved from src/connectors/source-connector.ts)
interface SourceConnector {
  sourceName: SourceName;        // 'sales' | 'engineering' | 'product'
  linkRelation: string;          // 'requests' | 'implements' | 'describes'
  fetchChanges(cursor?: string): Promise<ChangeBatch>;
}

interface ChangeBatch {
  // true  = every current item (upserts only); sync deletes anything missing (reconciliation).
  //         Used by file sources, which can't report deletions.
  // false = only changes since cursor, with explicit deletes (webhook/change-feed sources).
  isFullSnapshot: boolean;
  changes: SourceChange[];
  nextCursor: string;            // for snapshots: a fingerprint, unchanged source = same cursor
}

type SourceChange =
  | { type: 'upsert'; record: SourceRecord }
  | { type: 'delete'; externalId: string };

interface SourceRecord {
  externalId: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  allowedGroups: string[] | null; // null = unknown → stored but denied to everyone
  explicitFeatureKeys: string[];  // explicit feature IDs from the source (linked before aliases)
  updatedAt: string;
}

// Rule: a connector fails the WHOLE source on any bad item. A partial snapshot would make
// sync delete every item that failed to parse.

interface LlmProvider {
  // The model may answer with text or ask to call some of the offered tools.
  generate(messages: Message[], tools?: ToolSpec[]): Promise<LlmReply>;
}

type LlmReply =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; text: string; calls: { id: string; name: string; args: unknown }[] };

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

interface PolicyEngine {
  isAllowed(
    caller: VerifiedCaller,
    action: string,
    resource: Resource,
  ): Promise<boolean>;
}
```

These are starting points, not fixed contracts. Keep them small.

## Knowledge model

Use four core concepts:

- **Records:** One item from a source, with source ID, metadata, timestamps, and permissions
- **Chunks:** Searchable text and embeddings created from records
- **Entities:** Shared business objects, such as `Feature: Dark mode`
- **Links:** Relationships between records and entities, such as `implements`, `requests`, or `describes`

For the PoC, link records using explicit IDs first and known aliases second. Do not use LLM-based matching.

## MCP tools

Keep the toolset small:

- `search_knowledge`: Searches permitted knowledge
- `get_feature_context`: Returns permitted records linked to a feature

Tool visibility must be filtered by caller, and every tool call must be authorized again. Search and feature tools must apply agent and user permissions in the data query, not after building the final answer.

Return source details and timestamps with results. Do not reveal whether restricted records exist.

## Mock identity

Use mock API keys or tokens to represent:

- The calling agent
- The user the agent is acting for
- The user's groups

Include at least two users with different access, such as a Product user and a Sales user. Identity must be resolved by the MCP service, not supplied by the LLM.

## Required demo scenarios

1. Ask about a feature and receive an answer that uses Sales, Engineering, and Product sources.
2. Ask the same question as another user and show different results based on permissions.
3. Edit a source record, run sync, and show the updated answer.
4. Delete a source record, run sync, and show that it no longer appears.
5. Verify that missing permission metadata is denied by default.
6. Verify that a prompt cannot make the agent bypass access control.

## Testing and evaluation

Add automated checks for:

- Connector parsing
- Sync additions, edits, and deletions
- Entity linking through IDs and aliases
- Tool visibility
- Permission enforcement
- Default denial
- Retrieval relevance on a small test set
- Answer citations or source references

Keep the evaluation set small and easy to run.

## Documentation requirements

The README must include:

- What the PoC proves
- Setup instructions
- Environment variables
- How to run sync
- How to run the MCP service
- How to run the agent demo
- How to run tests
- Assumptions and limitations
- How the PoC maps to the production design

Maintain `docs/ai-sdlc.md` during the work. Briefly describe how AI was used across design, implementation, testing, and review. Do not invent any process or result.

## Production design document

The final document must cover:

- Architecture
- Data connection
- Knowledge representation
- Agent access
- Self-maintenance
- Technology choices and rejected alternatives
- Trade-offs
- Quality evaluation, monitoring, and response actions

It must include a clear system diagram, explicit assumptions, the reasoning behind each major choice, and honest risks. Separate what is known from what is assumed.

Important design points to include:

- Departments own their sources and data contracts
- Connectors support webhooks, scheduled sync, reconciliation, and manual sync
- Permission changes propagate as first-class updates
- Stale permissions are a major risk
- Highly sensitive data stays at the source and uses live access
- PDFs without reliable permissions require storage-based inheritance or owner-provided manifests
- Mixed-sensitivity PDFs should preferably be split
- Regional data residency affects storage, processing, and model choice
- The MCP service is critical infrastructure and needs high availability

## Working style

- Start by proposing a short implementation plan.
- Build one working slice at a time.
- Prefer simple, readable code over framework-heavy abstractions.
- Do not add production infrastructure unless asked.
- State assumptions and tradeoffs as you make them.
- Run tests after meaningful changes.
- Do not claim something works unless you ran it or clearly say it was not run.
