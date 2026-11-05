# Company Knowledge Layer (PoC)

A small, working knowledge layer for AI agents, built for the ShopFully & Flipp AI Engineer take-home.

It pulls data from three pretend department sources (Sales CSV, Engineering JSON, Product Markdown), keeps it in sync, links it to shared features, and lets agents read it through one MCP service that only returns what **both** the agent and the user are allowed to see.

The demo question is: _"Should we prioritize dark mode next?"_

## Status

| Step | What | State |
|---|---|---|
| 1–4 | Database, mock data, connectors, sync | ✅ Done |
| 5 | Permission-aware search | ✅ Done |
| 6 | MCP service (identity, tool access, audit log) | ✅ Done |
| 7 | AI models through OpenRouter | ✅ Done |
| 8 | Roadmap agent you can ask questions | ✅ Done |
| 9 | Evaluation set, demo script for the 6 scenarios | Next |
| 10 | Design document | To do |
| 11 | Optional: small web page showing the agent's steps live | If time allows |

## What the PoC proves

- **Linked:** a sales request, an engineering ticket and a product doc about the same feature are connected, by explicit feature ID or by known names ("night mode" → dark mode).
- **Current:** edits and deletions in a source show up after the next sync. Permission changes apply immediately.
- **Permission-controlled:** access is checked inside the database query, outside the AI model. Records with missing permissions are denied to everyone, and a hidden record looks exactly like a missing one.

## How it works

```text
 Agent (key) acting for a user (token)
        │  HTTP
        ▼
 MCP service      keys → verified caller → only that agent's tools
                  → re-check every call → search with permission filter → audit log
        │
        ▼
 PostgreSQL + pgvector     records · chunks · features · links · permissions · audit log
        ▲
        │  npm run sync (adds, edits, deletes; one transaction per record)
 Connectors       Sales CSV · Engineering JSON · Product Markdown   (data/sources/)
```

## Requirements

- Node.js 20 or newer (CI uses 24)
- Docker (for PostgreSQL with pgvector)

## Setup

```bash
npm ci
cp .env.example .env
npm run db:up        # starts PostgreSQL on localhost:5433
npm run db:migrate   # creates the tables
npm run sync         # loads the mock sources
```

With `OPENROUTER_API_KEY` set, check the key and models first (costs a fraction of a cent):

```bash
npm run models:check
```

The first sync adds 12 records and prints one warning: ticket `ENG-60` has no permissions in its source, so it is stored but denied to everyone. With a key set, it also embeds the 12 chunks for meaning search. Running sync again changes nothing.

`npm run db:down` stops the database. The data is kept in a Docker volume.

## Environment variables

| Name | Default | Used for |
|---|---|---|
| `DATABASE_URL` | `postgres://knowledge:knowledge@localhost:5433/knowledge` | The demo database |
| `TEST_DATABASE_URL` | Same server, database `knowledge_test` | Tests (never touches demo data) |
| `MCP_PORT` | `3100` | The MCP service |
| `AGENT_KEY` | `dev-agent-roadmap` | Which agent the CLI acts as |
| `MCP_URL` | `http://127.0.0.1:<MCP_PORT>/mcp` | Where the CLI finds the MCP service |
| `OPENROUTER_API_KEY` | (empty) | AI models. Without it, search uses keywords only and the agent can't run |
| `OPENROUTER_CHAT_MODEL` | `anthropic/claude-sonnet-5.5` | The agent's chat model (must support tool calls) |
| `OPENROUTER_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Meaning search. Changing it is safe: the next sync re-embeds everything |

## Run sync

```bash
npm run sync
```

Try a change: edit a request in `data/sources/sales/feature_requests.csv` (or delete a row, or a file in `data/sources/product/`), run sync again, and the table shows what was updated or deleted.

## Run the MCP service

```bash
npm run mcp          # listens on http://127.0.0.1:3100/mcp
```

Every request must carry two headers: the agent's key and the user's token.

| Who | Header | Value | Access |
|---|---|---|---|
| Roadmap agent | `x-agent-key` | `dev-agent-roadmap` | Sales, Engineering, Product · both tools |
| Product FAQ agent | `x-agent-key` | `dev-agent-product-faq` | Product only · search only |
| Paula (Product) | `x-user-token` | `dev-user-paula` | group `product` |
| Sam (Sales) | `x-user-token` | `dev-user-sam` | group `sales` |

In another terminal, ask for everything about dark mode as Paula, then as Sam:

```bash
for user in dev-user-paula dev-user-sam; do
  curl -s http://127.0.0.1:3100/mcp \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -H 'x-agent-key: dev-agent-roadmap' \
    -H "x-user-token: $user" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_feature_context","arguments":{"feature":"dark-mode"}}}' \
  | jq -r --arg u "$user" '.result.content[0].text | fromjson | "\($u): " + ([.records[].externalId] | join(" "))'
done
```

```text
dev-user-paula: ENG-43 ENG-42 PRD-9 PRD-11 PRD-7 S-102 S-101
dev-user-sam: PRD-11 PRD-7 S-103 S-102 S-101
```

(Without `jq`, drop the last line to see the full JSON, including each record's text, source and update time.)

Paula gets 7 records (including the engineering tickets). Sam gets 5, including the sales-only Lidl renewal, which Paula never sees. Other things to try:

- `"method":"tools/list"` with the Product FAQ agent key: only `search_knowledge` is listed.
- A wrong or missing key: `401`.
- `search_knowledge` with `{"query":"screens too bright for staff at night","limit":4}`. With a key set, `mode` is `hybrid` and it finds the dark mode records without the words "dark mode".

Every call is recorded in the `audit_log` table.

Any MCP client that can send custom headers over Streamable HTTP can connect too.

## Run the agent demo

Needs `OPENROUTER_API_KEY` in `.env` and the MCP service running (`npm run mcp` in another terminal).

```bash
npm run agent -- --user paula "Should we prioritize dark mode next?"
npm run agent -- --user sam "Should we prioritize dark mode next?"
```

The agent prints each tool call as it happens, then the answer, then the sources it cited (with where each came from and when it was last updated):

```text
→ get_feature_context {"feature":"dark-mode"}
  ← 7 records: ENG-43 ENG-42 PRD-9 PRD-11 PRD-7 S-102 S-101
→ search_knowledge {"query":"dark mode"}
  ← 5 records: PRD-7 ENG-42 S-101 ENG-43 S-102

**Recommendation: Yes, make dark mode a near-term priority, but start with the charts spike (ENG-43) ...
```

What to look for (from a real run):

- **Paula (Product)** gets engineering effort and risks ([ENG-42], [ENG-43]) and the Q1 roadmap draft, but never the confidential Lidl deal.
- **Sam (Sales)** gets the Lidl deal ([S-103], €240k at risk), but no engineering tickets, and the agent says that evidence is missing.
- **Both** runs notice the planted "ignore previous instructions" text in the feedback digest and treat it as content.
- If the answer cites an ID that no tool returned, the CLI flags it.

`--user` picks a user from `policies.yaml` (a demo shortcut; in production the token comes from the user's login). Set `AGENT_KEY=dev-agent-product-faq` to ask through the narrower agent.

## Tests

The database must be running (`npm run db:up`).

```bash
npm test             # all tests, against the separate knowledge_test database
npm run check        # lint, formatting and type checks
npm run format       # fix formatting
```

GitHub Actions runs both on every pull request.

## Project layout

```text
data/          mock sources, feature list (features.yaml), agents and users (policies.yaml)
db/migrations/ SQL schema
scripts/       migrate, sync, mcp, agent, check-models
src/
  connectors/  one per source, behind a shared interface
  sync/        adds, edits and deletes; chunks; feature links
  knowledge/   permission-aware search and feature lookup
  policy/      agents, users, identity, tool grants
  mcp/         MCP service, tools, audit log
  providers/   AI model adapters (OpenRouter through LangChain)
  agent/       roadmap agent: our own tool loop, MCP client
  types/       shared types (types only)
tests/
docs/ai-sdlc.md  how AI was used to build this
```

## Assumptions and limitations

- Sources are local files standing in for Salesforce, Jira and Notion. File exports can't report deletions, so each sync compares the full export with what is stored.
- Users, groups and keys are plain strings in `policies.yaml`. Production would use the company login (SSO) and real service credentials.
- Sync runs on demand. Production would trigger it from webhooks and schedules, with a nightly full check.
- Feature linking uses explicit IDs and a fixed list of names; no AI matching.
- Vector search is exact (no index), which is fine at this size.

## How this maps to production

The full design document comes in step 10. In short: the same pieces, with real connectors owned by each department, a job queue and background workers for sync, the company login for identity, a highly available MCP service, and live access (instead of copying) for highly sensitive data.
