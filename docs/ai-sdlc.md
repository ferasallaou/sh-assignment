# How AI was used (AI-SDLC log)

A running, factual log. Updated as the work happens; nothing here is written ahead of time.

The repository history was rebuilt from an earlier working repo into one clean commit per step. The code and notes were carried over unchanged; each step's log entry is added in the same commit as that step.

Tool: Claude Code (Claude Opus 5.5) in the terminal, working in this repository.

## Design

- Read the assignment PDF and the job posting with the assistant, then shaped the system through a long back-and-forth discussion: what "knowledge" covers (documents, records, live data), whose permission counts (agent scope **and** user), where the router fits, and copying vs live lookup.
- Used web search through the assistant to check how others build "context layers" for agents and which products exist (Glean, Onyx, Microsoft Copilot, n8n), to prepare the buy-vs-build section.
- The human pushed back several times: when the assistant mixed up "build a chatbot" with "build the knowledge layer", when it rushed to tool names before the big picture was agreed, and when it then over-asked about low-stakes details. The human also wrote their own design outline, which the assistant reviewed for gaps.
- Decisions were saved in `DECISIONS.md`, `PLAN.md` and `CLAUDE.md`, and updated whenever something changed, to avoid drift between sessions.

## Implementation

- **Step 1 (skeleton):** the assistant wrote the project setup, the Docker database, the SQL schema, the migration runner, the config check and the first test. Problems found while running it, and how they were fixed:
  - TypeScript 7 removed an old setting, and ts-jest doesn't support it yet → pinned TypeScript `~5.9`.
  - NestJS 12 is ESM-only and failed to load under Jest → pinned NestJS `^11`.
  - The test tried to start an HTTP server it didn't need → it now starts only Nest's dependency container.

- **Step 2 (mock data and identities):** the assistant designed the mock records around three features, so each demo scenario has a concrete case: a sales-only record, records linked only by alias, a ticket with missing permissions, and a document with a planted instruction. It added a second, narrower agent to test tool visibility, plus validated loaders for `policies.yaml` and `features.yaml`.
- **Step 3 (connectors):** the assistant wrote the Sales CSV, Engineering JSON and Product Markdown connectors behind one shared interface. While designing it, it found that file sources can't report deletions, so it extended the planned interface with `isFullSnapshot` (sync deletes whatever is missing). Because of that, any bad item fails the whole source, so a partial read can never trigger wrong deletions. It also added `title`, `explicitFeatureKeys` and nullable `allowedGroups` to the record shape, and updated `CLAUDE.md` to match.
- **Step 4 (sync):** the assistant wrote the sync service, chunker, feature linker (by ID, then alias, without AI) and the `npm run sync` command. Design choices it made and recorded:
  - A second fingerprint per record, so permission-only changes skip re-chunking.
  - An empty-export guard against wiping a source.
  - Per-source failure isolation.
  - Embeddings as a separate "fill what's missing" pass, so a model outage never blocks syncing.
  - A separate test database after noticing that sync tests would otherwise wipe the demo data.
  - The first full test run caught a step 1 test that assumed an empty database; it was fixed to check only its own record.
- **Step 5 (permissions and search):** the assistant wrote the search service with two lookups (by question and by feature). The access rule is one SQL condition shared by both, so it is applied before ranking and nothing restricted leaves the database. Choices it made: match any word of a question (checked on the test data: requiring all words matched 0 pieces for "Should we prioritize dark mode next?", any word matched 8), merge keyword and meaning rankings by rank position rather than by raw scores, and fall back to keyword search if the embedding model fails. Before starting, it noticed there was no branch for the step yet and created `feat/permission-search`.
- **Step 6 (MCP service):** the assistant wrote the MCP service, identity lookup from request keys, per-caller tool lists, a re-check on every call, strict tool inputs with no identity fields, and the audit log. It checked the MCP SDK versions first and chose the stable 1.x package over the newer split 2.x packages. It used the SDK's lower-level server, which its docs mark "for advanced use", because the simpler one rejects hidden tools before our code runs, so those attempts couldn't be audited. Running the real service by hand (not just the tests) found a bug the tests missed: `npm run mcp` runs through tsx, which skips the type information Nest uses to wire services together, so the audit service was missing and every tool call failed. The fix was to name each dependency explicitly. It also added a test that starts the service the same way a user does, and checked that this test fails without the fix.

## Testing

- Step 1: `npm test` runs 4 database tests (tables exist, pgvector works, full-text search works, bad config is rejected). All pass.
- Step 2: 9 more tests (policies and catalog are valid, duplicate keys and unknown tools are rejected, and the mock data contains every demo case). 13 tests in total, all passing.
- Step 3: 14 more connector tests (field mapping, quoted CSV text, missing permissions become "unknown", missing feature IDs, bad rows, invalid JSON, duplicate IDs, missing front matter, and the snapshot fingerprint changing only on edits). 27 tests in total, all passing on the first run.
- Step 4: 21 more tests for chunking, linking, and sync (adds, edits, permission-only changes, deletes of rows and files, skipping unchanged sources, the empty-export guard, a broken source not blocking others, retry after failure, and embeddings filled later). 48 tests in total, all passing. Also ran `npm run sync` twice on the demo database: the first run added 12 records and warned about ENG-60, and the second run changed nothing.
- Step 5: 15 more tests (different results for Paula and Sam, a user in every group still can't see the ticket with missing permissions, the narrower agent stays in its sources, a restricted record named exactly in the question is not returned, "restricted" and "nothing matches" give the same empty answer, meaning search finds records with no shared words, and keyword fallback when the model fails). All 15 passed on the first run, so the assistant removed the permission condition on purpose to check the tests can fail: 8 of them failed, then passed again once it was restored. 63 tests in total, all passing.
- Step 6: 14 more tests that start the real service and connect with the MCP SDK client (bad or missing keys all get the same 401, a user key can't act as an agent key, tool arguments that try to switch user are rejected, each agent sees only its tools, a hidden tool is refused and audited, Paula and Sam get different answers, every result has source and update time, ENG-60 never appears, and every call is audited). All passed on the first run, so the assistant removed the per-call re-check on purpose: 1 test failed. It then ran `npm run mcp` by hand, found the bug above, and added a start-up test (fails without the fix, passes with it). 77 tests in total, all passing. On the demo data, the real service gave Paula 7 dark mode records and Sam 5, and both calls were in the audit log.

## Review

- **CI and lint:** the assistant added ESLint, Prettier and a GitHub Actions workflow (checks job, and a tests job with a pgvector Postgres service). It ran everything locally first. ESLint found 1 real issue (a re-thrown migration error that lost its original cause), which was fixed. Prettier reformatted 11 code and config files. Markdown docs were deliberately excluded from formatting. It also checked the CI steps in a clean copy (fresh `npm ci`, no `.env`): checks and all 48 tests passed.
