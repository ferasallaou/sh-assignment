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

## Testing

- Step 1: `npm test` runs 4 database tests (tables exist, pgvector works, full-text search works, bad config is rejected). All pass.

## Review

- **CI and lint:** the assistant added ESLint, Prettier and a GitHub Actions workflow (checks job, and a tests job with a pgvector Postgres service). It ran everything locally first. ESLint found 1 real issue (a re-thrown migration error that lost its original cause), which was fixed. Prettier reformatted 11 code and config files. Markdown docs were deliberately excluded from formatting. It also checked the CI steps in a clean copy (fresh `npm ci`, no `.env`): checks and all 48 tests passed.
