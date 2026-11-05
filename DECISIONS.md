# Shopfully take-home: decisions and findings so far

Saved on 2026-11-04. **This file wins over `PLAN.md` where they disagree.** `PLAN.md` is the older draft. **`CLAUDE.md` is now the source of truth for the demo build** (PostgreSQL + pgvector, OpenRouter for chat and embeddings, MCP over HTTP, roadmap agent CLI, no router or UI in the demo).

## The assignment (source: `~/Downloads/AI_Engineer_x_Shopfully_Take_home_assignment.pdf`)

- Build a **knowledge layer for AI agents**, not a chatbot. The agents "don't exist yet" and will be built later. Knowledge must be **accurate, current and authorized at the moment agents act**.
- It has to handle distributed department sources (different formats, access methods and owners), turn their data into knowledge agents can use, expose it through **one consistent access layer**, and **maintain itself** through additions, edits and deletions with no manual work.
- **Deliverable 1:** a design document for the full production-scale system. It must answer: architecture and data flow, data connection, knowledge representation, agent access, self-maintenance, technology choices with rejected alternatives, trade-offs, and quality evaluation and monitoring. It needs a diagram, explicit assumptions and the reasoning behind every choice.
- **Deliverable 2:** a lightweight working demo on one use case, built with AI coding tools, on GitHub, with clear setup steps and a short note on our AI-assisted development process.
- **What they grade most:** depth of reasoning, honesty about risks, and critical thinking (questioning the brief, separating what we know from what we assume).
- Effort: 4–6 hours total.

## Settled decisions

1. **We build it as engineers:** the knowledge layer plus real agents on top. Don't over-question the brief; pick sensible defaults and state them.
2. **"Knowledge" means three things:**
   - **Documents** (policies, wikis, PDFs): copied in, cut into pieces, searched by meaning.
   - **Records** (deals, tickets, headcount, numbers): copied in, kept as tables, queried exactly (never by meaning only), and linked across departments.
   - **Live data** (personal or fast-changing, like leave balances or today's pipeline): never copied, fetched from the source at the moment of the question, as that person.
3. **Authorization: both must allow.** The agent's job scope **AND** the person's own access. Agents that run with no person behind them use only their job scope.
4. **Permissions are enforced in code, never by the AI.** Identity comes from the company login, never from the chat. The tool list is built per person before the agent runs. Every search filters by permission inside the database query. Live lookups use the person's own login. **Deny by default** when permissions are unknown. Agents are read-only, have step and call limits, and every action is logged. Text found in documents is treated as information, never as instructions.
5. **Bringing data in is a separate flow** from answering questions. They share only the stored knowledge. It is started by: change notifications from sources, timed checks, a nightly full comparison (catches missed deletions) and manual reloads or first-time loads.
6. **One front door** for all agents: an MCP service (plus a normal API if needed). It checks identity, enforces permissions, runs the search and logs requests. Agents may be built by any team with any tool. Our agents use LangChain, which can connect to MCP through `@langchain/mcp-adapters`.
7. **One company-wide UI** with a **router** that sends each question to the right specialist agent. **No department picker.** The router only offers agents the person is allowed to use, but the real lock is the per-document permission check.
8. **Notion has its own MCP**, but for bulk copying, Notion's normal API with change notifications fits better; its MCP is built for one person chatting. PDFs have no MCP: connect to wherever they are stored (Drive, SharePoint, a folder), pull out the text (with text recognition for scanned files), and use a watched local folder in the demo.
9. **Production should not need a UI for the layer itself** (its users are agents). Nice to have: an admin page showing sync status per source.
10. **Buy vs build** goes in the document: Glean (paid, keeps source permissions), Onyx (open source, permission syncing only in the paid edition), Microsoft Copilot, n8n (a workflow tool; its forums show deletions and permissions are weak spots), and Airbyte or Nango for ready-made connectors.

## Tech decisions (confirmed 2026-11-04, details in `CLAUDE.md` and `PLAN.md`)

- TypeScript and **NestJS**. In production it is one codebase run as **two programs** (front door and background worker) that can be split into separate services later.
- **PostgreSQL + pgvector** (via Docker) for the demo **and** production. Text, vectors, tables, links, permissions and sync status live in one place, so an edit or deletion changes them all in one transaction. This replaced the SQLite assumption at the user's request. Rejected: Pinecone-style vector databases (a second system to keep in sync, harder deletions), Neo4j (link tables are enough at first) and SQLite (doesn't match production). In production, a Redis job queue sits in front of the worker; the demo runs sync on demand.
- **OpenRouter** for chat and embeddings (the user has a key).
- **LangChain** is used only as the model adapter, behind `LlmProvider` and `EmbeddingProvider`. The model picks tools through LangChain tool binding, but the **agent loop is our own code**, and every tool call goes through the MCP service.
- **MCP over HTTP**. Mock agent and user keys go in each request, and the service resolves identity.
- **Demo scope:** the roadmap agent CLI only. No router or UI. The HR agent and its live `get_leave_balance` tool come later, if time allows.

## The user's design outline (latest version, pasted 2026-11-04)

Diagram: company-wide UI → router → agents (HR, roadmap, future) → MCP service → knowledge base ← sync and processing pipeline ← connectors ← sources. A separate **live access** path runs from the MCP service straight to the sources.

- **Sync connectors** bring content and permissions in through a shared interface. **Live connectors** fetch at question time.
- The pipeline handles additions, edits and deletions from backfills, webhooks, scheduled syncs and reconciliation. It cuts content into pieces, adds embeddings and links entities.
- The knowledge base stores entities, relationships, searchable text, embeddings, permissions and source details.
- The MCP service checks identity, enforces permissions, runs searches and logs requests.
- **Core rules:** ingest by default, but fetch very sensitive or fast-changing data live; enforce permissions outside the AI; deny by default; keep providers swappable.
- **Router:** a future extension, not part of the demo. It uses structured output.
- **Demo:** a small **roadmap** use case (changed from HR), with NestJS, mocked Markdown/CSV/JSON sources, permission-aware MCP tools, OpenRouter for models, and tests for answers, permissions and deletions.
- **Still open at the time:** the knowledge model, production technology choices, scale assumptions and the demo's storage choice. *Since closed: the knowledge model is records, chunks, entities and links (`CLAUDE.md`), and storage is PostgreSQL + pgvector.*

## Review of the user's outline

- **Strong:** the core rules (deny by default, permissions outside the AI, swappable providers), reconciliation alongside webhooks, and the separate live path.
- **Gaps:**
  1. The **knowledge model** is still open, yet it's a main question in the PDF.
  2. There is no **quality and freshness monitoring** part (also a direct PDF question).
  3. Nothing says how **permission changes** in a source reach our copy quickly ("permission drift" is the biggest risk).
- **Demo choice:** the roadmap demo shows cross-department linking better than HR, but it's riskier in 4–6 hours, so keep its data small.

## Main risks to state honestly

- Permission drift: sharing changes in a source, but our copy keeps the old rules.
- Missed deletions from sources that don't send notifications (the nightly check means up to a day of delay).
- Wrong answers that sound confident. Always show sources, and prefer "I don't know".
- The router picking the wrong agent.
- Cost and load from AI calls and live lookups.

## How to work with this user

- Plain words and short replies.
- Shape the big picture together before building. Don't rush to tool names, and don't swing the other way into asking about trivia or reading the brief too literally. Make sensible calls, state them, and move on.
