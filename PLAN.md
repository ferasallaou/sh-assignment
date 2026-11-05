# Shopfully take-home: implementation plan (approved 2026-11-04)

Source of truth for the build: `AGENTS.md`. Background and reasoning: `DECISIONS.md`.

## Scope right now

- **Roadmap agent only.** It answers questions like "Should we prioritize dark mode next?" using mocked Sales, Engineering and Product data.
- **Not now:** real integrations, real login. A small web page is step 11 (added 2026-11-05).
- **Added 2026-11-05 (step 12):** an HR agent with a live lookup, and a router that picks the agent, so the page no longer needs an agent picker. See `DECISIONS.md`, "Router and HR agent".

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
5. ✅ **Permissions and search (done, 63 tests passing; keyword-only until step 7 adds embeddings):** combine full-text and vector search in one SQL query, filtered by the user's groups **and** the agent's scope. Deny by default. Tests, including that hidden records are never hinted at.
6. ✅ **MCP service (done, 77 tests passing, `npm run mcp` works):** resolve identity from the mock keys, filter tool visibility per caller, re-check every call, return source and timestamp, and log every call. Tools: `search_knowledge` and `get_feature_context`. Tests.
7. ✅ **AI model adapters (done, 89 tests passing, `npm run models:check` works):** OpenRouter chat with tool binding via LangChain behind `LlmProvider`, and OpenRouter embeddings behind `EmbeddingProvider`.
8. ✅ **Roadmap agent CLI (done, 98 tests passing, `npm run agent` works with the real model):** our own tool loop with step and call limits, answers with source references.
9. ✅ **Proof (done, 103 tests passing; `npm run eval` and `npm run demo` pass with the real model):** a small evaluation set, one demo script covering all 6 required scenarios (including a prompt that tries to bypass access), the README, and `docs/ai-sdlc.md`, updated as we go.
10. ✅ **Design document (done, `docs/design.md`):** written after the demo works, covering every section the PDF asks for.
11. ✅ **Web page (done, 111 tests passing, `npm run dev` works with the real model; added 2026-11-05):** a small web page where you pick a user and ask a question, and the agent's steps (tool calls, results, then the answer) stream in live over SSE (server-sent events). It reuses the step 8 agent loop; the CLI stays the main demo. Plain and functional, not polished.
12. ✅ **Router and HR agent (done, 129 tests passing, checked in the browser with the real model; added 2026-11-05):** answers "How many vacation days do I have left?" by reading the synced leave policy and fetching the user's own balance live from a pretend HR system.
    - **HR source:** a fourth synced source, HR policy documents in Markdown (`backend/data/sources/hr/`). The leave policy is shared with all staff groups; a salary bands document is HR-only (nobody in the demo), to show denial again.
    - **Live lookup:** a new MCP tool, `get_leave_balance`, with no input. The MCP service returns only the signed-in user's own balance, read fresh from a pretend HR system on every call, never stored. Editing the HR data changes the next answer with no sync.
    - **HR agent:** its own key, scope (`hr` source only) and instructions, using the same agent loop as the roadmap agent.
    - **Router:** one model call that picks an agent from the ones this user may use (new `offered_to_groups` field), or none. It has no data access; the chosen agent still goes through the MCP service with its own key.
    - **Page:** the agent picker is removed; each answer shows which agent the router chose and why.
    - **Tests:** the HR connector, own-balance-only, no balance for unknown users, the roadmap agent can't see HR data or the live tool, the router's choices and its fallback, and the streamed "routed" step. Eval: an HR retrieval case.
13. ✅ **HR web service and salaries (done, 137 tests passing, checked in the browser with the real model; added 2026-11-05):** answers "What is my salary?" and refuses "What is Paula's salary?" for an engineer, with the refusal made by the MCP service, not the model.
    - **HR web service:** the pretend HR system becomes its own small HTTP service (`npm run hr-api`, port `HR_API_PORT`, default 3300), started by `npm run dev`. The MCP service calls it over HTTP with a service key, like a real external API. Nothing from it is stored.
    - **Salary tool:** `get_salary`, with an optional colleague name. The MCP service decides: your own pay is always allowed; anyone else's only if you are in the `hr` group. A refusal gives the same message whether the colleague exists or not, and is logged as refused.
    - **New user:** Hana (HR), group `hr`, who may see everyone's pay and the HR-only salary bands.
    - **Tests:** the HR service's key check and live reads; own salary; an engineer refused for a colleague (audited); an unknown name refused the same way; HR allowed; the roadmap agent can't call it.

## Rules while building

- Build one slice at a time and run tests after each meaningful change.
- Never claim something works without running it.
- Update this file, `DECISIONS.md` and `AGENTS.md` whenever a decision changes, so the plan doesn't drift.
