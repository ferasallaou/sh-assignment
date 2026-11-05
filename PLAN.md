# Shopfully take-home: implementation plan (approved 2026-11-04)

Source of truth for the build: `CLAUDE.md`. Background and reasoning: `DECISIONS.md`.

## Scope right now

- **Roadmap agent only.** It answers questions like "Should we prioritize dark mode next?" using mocked Sales, Engineering and Product data.
- **Not now:** HR agent, router, UI, live lookups, real integrations, real login.
- **HR agent comes later, if time allows.** It would add an HR connector, an agent key and scope in `policies.yaml`, and its own instructions and tool list. An optional live tool, `get_leave_balance`, would ask a pretend HR system as the user. Sync, the database, the permission checks and the MCP service stay unchanged.

## Confirmed stack

| Part | Choice |
|---|---|
| Language and framework | TypeScript, NestJS |
| Storage | PostgreSQL + pgvector via `docker compose`. Full-text search and vectors are combined in one SQL query with the permission filter. Each record change is applied in one transaction. |
| AI models | OpenRouter for chat **and** embeddings, models set in `.env` (the user has a key) |
| AI adapter | LangChain.js only behind `LlmProvider` and `EmbeddingProvider`. The model picks tools through LangChain tool binding. **The agent loop is our own code** and runs every tool call through the MCP service. |
| Agent access | MCP TypeScript SDK over HTTP. Every request carries mock agent and user keys, and the service resolves identity. |
| Validation and tests | Zod, Jest |

## How it works

```
 QUESTION FLOW                                   SYNC FLOW (separate, run on demand)

 Roadmap agent CLI (agent key + user key)        npm run sync
   loop: ask AI which tool → call it             Connectors: Sales CSV · Eng JSON · Product MD
         via MCP → repeat → answer                 → compare with last run (adds/edits/deletes)
         with sources                              → chunks → embeddings → link to features
        │ HTTP + keys                              → keep permissions (one transaction each)
        ▼                                                 │
 MCP service: keys → caller → allowed tools →             ▼
   re-check each call → search with permission     PostgreSQL + pgvector
   filter inside the query (deny if unknown) →     records · chunks · entities · links ·
   results + source + date → audit log  ◀────────▶ permissions · sync state · audit log
```

## Build steps (one tested slice at a time)

1. ✅ **Skeleton (done, 4 tests passing):** NestJS project, startup settings check (Zod), `docker compose` with PostgreSQL + pgvector, and database setup scripts for records, chunks (full-text and vectors), entities, links, sync state and the audit log.
2. ✅ **Pretend data and identities (done, 13 tests passing; see `data/README.md`):** Sales CSV, Engineering JSON and Product Markdown about features like dark mode. `policies.yaml` holds the agent key and scope, plus two users (Product and Sales) with groups and keys. One record has missing permissions on purpose.
3. ✅ **Connectors (done on branch `feat/FE3-create-connectors`, 27 tests passing):** three connectors behind `SourceConnector`, with parsing tests.
4. ✅ **Sync (done, 48 tests passing, `npm run sync` works; embeddings wait for step 7):** compare with the last snapshot to find adds, edits and deletes; one transaction per record; chunks inherit permissions; missing permissions are stored but never shown; link to features by explicit IDs, then known aliases. Tests for add, edit, delete and linking.
5. **Permissions and search:** combine full-text and vector search in one SQL query, filtered by the user's groups **and** the agent's scope. Deny by default. Tests, including that hidden records are never hinted at.
6. **MCP service:** resolve identity from the mock keys, filter tool visibility per caller, re-check every call, return source and timestamp, and log every call. Tools: `search_knowledge` and `get_feature_context`. Tests.
7. **AI model adapters:** OpenRouter chat with tool binding via LangChain behind `LlmProvider`, and OpenRouter embeddings behind `EmbeddingProvider`.
8. **Roadmap agent CLI:** our own tool loop with step and call limits, answers with source references.
9. **Proof:** a small evaluation set, one demo script covering all 6 required scenarios (including a prompt that tries to bypass access), the README, and `docs/ai-sdlc.md`, updated as we go.
10. **Design document:** written after the demo works, covering every section the PDF asks for.

## Rules while building

- Build one slice at a time and run tests after each meaningful change.
- Never claim something works without running it.
- Update this file, `DECISIONS.md` and `CLAUDE.md` whenever a decision changes, so the plan doesn't drift.
