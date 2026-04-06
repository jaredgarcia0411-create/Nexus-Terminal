# Agentic Memory: LLM Wiki vs AGENTIC_EXPANSION Crash Course
**Researched**: 2026-04-06
**Sources**: Official docs, Karpathy gist, codebase analysis, architecture/spec review
**Context**: Codebase-specific research for Nexus Terminal

---

## Concept Overview
Karpathy's LLM Wiki pattern treats memory as a compiled, persistent knowledge artifact instead of a pile of raw documents retrieved at query time. The core move is to keep raw sources immutable, then continuously fold them into an editable, interlinked wiki so the system compounds understanding instead of rediscovering it from scratch on every question. Primary reference: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Your repo is aiming at a different but related target. The active memory design is not in `AGENTIC_EXPANSION.md`; the current spec in this repo is `AGENTIC_EXPANSIONV2.md` (`PRD.md:80`). That design is Postgres-first, agent-scoped, structured, and deliberately avoids vector RAG in V1 (`AGENTIC_EXPANSIONV2.md:17-27`). Instead of a markdown wiki as the main memory object, it prefers validated DB rows, deterministic context assembly, and code-gated memory writes.

The practical takeaway is that these are not opposing ideas. LLM Wiki is strong at malleable, human-readable synthesis. Your AGENTIC_EXPANSION design is strong at scoped memory, retrieval discipline, and operational safety. The strongest system for the research workflows you want is a layered combination of both, not either one alone.

## How It Works
LLM Wiki has three layers:

1. Raw sources: immutable documents, transcripts, datasets, filings, notes.
2. Wiki: persistent LLM-maintained pages that summarize entities, concepts, timelines, contradictions, and relationships.
3. Schema: instructions that tell the agent how to ingest, update, query, and lint the wiki.

The win is that the wiki becomes a reusable synthesis layer. Query-time retrieval starts from pages that already reflect prior reading and prior questions, so the agent spends fewer tokens rediscovering context and more tokens thinking.

Your planned AGENTIC_EXPANSION memory system works differently:

1. Persistent state lives in Postgres, not process memory (`AGENTS.md:60`, `AGENTIC_EXPANSIONV2.md:17-18`).
2. Planned `agent_memory_v2` stores memory as typed, scoped records with `user_id`, `agent_id`, `category`, `key`, `value_json`, `source`, `confidence`, and `expires_at` (`AGENTIC_EXPANSIONV2.md:223-245`).
3. Context is assembled by deterministic runtime modules like planned `memory.ts` and `context.ts` (`AGENTIC_EXPANSIONV2.md:1084-1085`).
4. LLM steps do not write memory directly; code validates candidates before persistence (`AGENTIC_EXPANSIONV2.md:2604-2619`).
5. V1 retrieval is intentionally symbolic and structured first, not vector-first (`AGENTIC_EXPANSIONV2.md:27`).

That means your design is already aligned with a major best practice from modern agent systems: workflow state should be structured and auditable, not hidden in chat transcripts or a giant vector store. Relevant official guidance: https://langchain-ai.github.io/langgraph/concepts/memory/ and https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/memory.html

## How It Applies Here
You do have real memory behavior in the codebase already, but it is narrow and research-specific rather than a general agent-memory runtime.

The clearest live example is the AskEdgar TLDR flow:

- `app/api/askedgar/tldr/route.ts:30-55` fetches fresh AskEdgar data, the stored `historicalSummary`, and the latest imported Discord report in parallel.
- `lib/research.ts:38-73` injects that `historicalSummary` and Discord report into the LLM prompt.
- `lib/discord/client.ts:46-139` computes and upserts `historicalSummary` from prior imported reports.

That is already a small compiled-memory loop. New research artifacts are imported, the system derives a persistent summary from them, and later prompts reuse that distilled context. Functionally, that resembles a tiny domain-specific wiki, except the compiled artifact is JSON in `ticker_research_summaries` instead of editable markdown.

So the current state is:

- You already have a useful, narrow memory pipeline for ticker research.
- You have a much better general memory architecture on paper in `AGENTIC_EXPANSIONV2.md`.
- You do not yet have the full `agent_memory_v2` runtime that would make this a reusable system across research, analysis, and multi-agent workflows.

## Codebase Evidence
- `AGENTIC_EXPANSIONV2.md:17-27`: Postgres is the backbone; no vector RAG in V1; retrieval is SQL, API calls, and structured memory.
- `AGENTIC_EXPANSIONV2.md:223-245`: planned `agent_memory_v2` adds `agent_id`, `source`, `confidence`, and expiry-scoped storage.
- `AGENTIC_EXPANSIONV2.md:1084-1096`: planned `memory.ts`, `context.ts`, and AskEdgar caching through `agent_memory_v2`.
- `AGENTIC_EXPANSIONV2.md:2604-2619`: code validates candidate memories; LLM steps never write memory directly; persisting raw LLM prose is banned.
- `PRD.md:80`: the full agent framework is still spec-only: "Nothing built yet."
- `AEV2_PLAN.md:102-109`: agent memory/context assembly and memory seeding are still planned stories.
- `lib/db/schema.ts:109-122`: legacy `agent_memory` exists today, but it is only `userId + category + key`, without `agent_id`, provenance, or confidence.
- `lib/db/schema.ts:124-165`: current research memory lives across `research_reports`, `imported_research_reports`, and `ticker_research_summaries`.
- `app/api/askedgar/tldr/route.ts:30-55`: live retrieval path for prior summary plus latest imported report.
- `lib/discord/client.ts:93-139`: live write path that recomputes and upserts `historicalSummary`.
- `drizzle/0004_good_princess_powerful.sql:1-33`: earlier embedding-based `jarvis_knowledge_chunks` table with `vector(768)` and `tsvector` search.
- `drizzle/0009_simple_riptide.sql:1-3`: that vector/wiki-adjacent chunk store was later removed.

## Code Examples
### Basic Usage
This is the layered memory pattern that best fits your repo. Raw evidence stays immutable, structured memory holds exact facts and state, and a canonical summary layer stays editable and compact:

```text
raw sources
  -> imported reports / filings / transcripts
  -> append-only job or event history
  -> structured memory rows (facts, preferences, workflow state)
  -> canonical summary artifact (ticker thesis, entity page, research brief)
  -> context assembly for the next LLM step
```

That matches modern agent-memory guidance better than either pure wiki-only memory or pure vector-only memory. References: https://langchain-ai.github.io/langgraph/concepts/memory/ and https://docs.letta.com/guides/agents/memory

### In Your Codebase
Current code already does a smaller version of this pattern:

From `app/api/askedgar/tldr/route.ts`:

```ts
const [askEdgarData, summaryRows, discordRows] = await Promise.all([
  getCachedTickerData(ticker),
  db
    .select({ historicalSummary: tickerResearchSummaries.historicalSummary })
    .from(tickerResearchSummaries)
    .where(and(eq(tickerResearchSummaries.userId, authState.user.id), eq(tickerResearchSummaries.ticker, ticker)))
    .limit(1),
  db
    .select({ rawText: importedResearchReports.rawText, reportDate: importedResearchReports.reportDate })
    .from(importedResearchReports)
    .where(and(eq(importedResearchReports.userId, authState.user.id), eq(importedResearchReports.ticker, ticker)))
    .orderBy(desc(importedResearchReports.reportDate))
    .limit(1),
]);
```

Then `lib/research.ts` injects that context into the analysis prompt:

```ts
options?.historicalSummary
  ? `\n<historical_summary>\n${JSON.stringify(options.historicalSummary, null, 1)}\n</historical_summary>`
  : ''
```

This is good evidence that the core research pattern you want is already emerging in one workflow.

## What You're Doing Right
1. You are choosing durable state over in-memory state, which is correct for Vercel and explicitly required by your repo rules (`AGENTS.md:60`).
2. You are favoring symbolic, structured retrieval for workflow state. That is the right default for jobs, checkpoints, approvals, watchlists, and exact research facts (`AGENTIC_EXPANSIONV2.md:17-27`, `AGENTIC_EXPANSIONV2.md:223-245`).
3. You separate code-owned truth from LLM-owned judgment. That is a strong design guardrail for memory quality (`AGENTIC_EXPANSIONV2.md:23-27`, `AGENTIC_EXPANSIONV2.md:2604-2619`).
4. You already have a narrow but real compiled-memory loop in research via imported reports plus `historicalSummary` (`lib/discord/client.ts:93-139`, `app/api/askedgar/tldr/route.ts:30-55`).
5. You were probably right to remove the earlier embedding-first chunk store when it stopped fitting the app's actual needs (`drizzle/0004_good_princess_powerful.sql:1-33`, `drizzle/0009_simple_riptide.sql:1-3`).

Bottom line: your current instincts on persistence, scoping, and not over-trusting vector RAG are good.

## Best Practices
1. Keep raw evidence immutable and separate from synthesized memory, so summaries can always drill back to source material. This is central to LLM Wiki and still fits your Postgres-first design. Source: Karpathy gist and `lib/db/schema.ts:138-165`.
2. Keep structured memory scoped by user, agent, category, and expiry. Your planned `agent_memory_v2` is stronger than the current legacy `agent_memory` for exactly this reason (`AGENTIC_EXPANSIONV2.md:223-245`).
3. Treat summaries as compiled artifacts, not raw truth. `historicalSummary` should remain a derived layer on top of imported evidence, not the only record of what happened (`lib/discord/client.ts:46-139`).
4. Use symbolic retrieval first for workflow state and exact research entities; add semantic retrieval only for long unstructured artifacts when the corpus justifies it. Sources: `AGENTIC_EXPANSIONV2.md:27`, https://www.postgresql.org/docs/current/textsearch.html, https://lilianweng.github.io/posts/2023-06-23-agent/
5. Attach provenance to promoted memory objects. Your planned `source` field is the right idea, but it needs strong semantics if you want trustworthy research memory (`AGENTIC_EXPANSIONV2.md:234`, https://docs.letta.com/guides/agents/memory).

## What Could Be Better
1. Add a first-class canonical summary layer. This is the main LLM Wiki benefit you do not fully have yet: a compact, revisable synthesis object for a ticker, thesis, workflow, or agent domain. Today you have `historicalSummary`, but only for one path and only as JSON (`lib/db/schema.ts:154-165`, `lib/discord/client.ts:93-139`).
2. Unify the memory story. Right now memory is split between legacy `agent_memory`, research tables, and planned `agent_memory_v2`. That makes future context assembly harder than it needs to be (`lib/db/schema.ts:109-165`, `AEV2_PLAN.md:102-109`).
3. Make provenance stricter. A plain `source` field is helpful, but deep research memory usually needs source IDs, timestamps, and a clean way to verify whether a summary is stale. This is the biggest epistemic gap in both many wiki systems and your current spec (`AGENTIC_EXPANSIONV2.md:223-245`, Karpathy gist comments on provenance concerns, and https://arxiv.org/abs/2310.08560).
4. Separate append-only task/event history from curated canonical knowledge. The spec is strong on jobs/checkpoints, but it is weaker on the exact shape of long-lived research artifacts that should survive across runs (`AGENTIC_EXPANSIONV2.md:1084-1088`, `AEV2_PLAN.md:102-106`).

## Common Pitfalls
**Pitfall**: Treating summaries as enough.
**Solution**: Keep drill-down access to imported reports, AskEdgar payloads, and other raw artifacts (`app/api/askedgar/tldr/route.ts:30-55`, `lib/db/schema.ts:124-165`).

**Pitfall**: Treating vector search as the whole memory architecture.
**Solution**: Keep vectors optional and secondary. Your V1 choice to prefer SQL/API/structured retrieval is sound for this app (`AGENTIC_EXPANSIONV2.md:27`).

**Pitfall**: Letting the LLM write canonical memory without deterministic checks.
**Solution**: Keep code-gated writes and structured validation. Your spec is already correct here (`AGENTIC_EXPANSIONV2.md:2604-2619`).

**Pitfall**: Fragmenting memory across unrelated systems.
**Solution**: Consolidate around one context-assembly path once `agent_memory_v2` exists (`AEV2_PLAN.md:102-109`).

## What You're Doing Wrong
The main problem is not that your design choices are conceptually wrong. The main problem is that the memory system you want is still mostly aspirational.

1. The repo does not yet have the full `agent_memory_v2` runtime described in the spec (`PRD.md:80`, `AEV2_PLAN.md:102-109`).
2. The current live memory surface is fragmented. Research memory exists, legacy `agent_memory` exists, and the future agent runtime is separate on paper.
3. You do not yet have a first-class, malleable canonical knowledge layer comparable to an LLM Wiki. `historicalSummary` is useful, but it is narrow, not generalized, and not obviously human-editable.

So the "wrong" part is mostly execution gap and missing synthesis layer, not wrong theory.

## Is This Enough For The Research/Analysis You Want?
For narrow report enrichment, yes, partially.

For the deeper research and analysis workflow you keep pointing toward, no, not yet.

Here is the blunt answer:

- Is it malleable memory right now? Only in a limited sense. `historicalSummary` is mutable, but it is a narrow derived object, not a broad editable knowledge substrate.
- Is retrieval efficient right now? Efficient for exact ticker lookups, yes. Efficient for broader cross-run, cross-artifact, cross-agent research retrieval, no.
- Is it enough to get the research/analysis done that you want? Not as a general system. It is enough for one focused research loop, not for a richer agent memory platform.

Deep research agents usually need all of the following:

1. Raw source artifacts.
2. Structured fact/state memory.
3. Task or project memory.
4. Canonical summaries or wiki-like syntheses.
5. A clear path from summary back to source.
6. Optional fuzzy retrieval over long artifacts.

Right now you have pieces 1, 2, and a thin version of 4. You do not yet have the full layered system.

## Recommended Default Approach
For this repo, the best default is a layered memory design:

1. Keep raw research artifacts immutable in tables like `imported_research_reports` and cached structured outputs (`lib/db/schema.ts:124-165`).
2. Implement `agent_memory_v2` as the authoritative structured memory layer for facts, preferences, watchlists, workflow state, and cached external results (`AGENTIC_EXPANSIONV2.md:223-245`, `AEV2_PLAN.md:102-109`).
3. Add a small canonical summary layer on top of that, either markdown-backed or JSON-backed but intentionally human-readable and revisable, for things like ticker thesis pages, research briefs, and agent-specific operating notes. This is the missing LLM Wiki-like layer (`lib/discord/client.ts:46-139`, Karpathy gist).
4. Use SQL and metadata filters first for retrieval. Add Postgres full-text search or vector retrieval only where you have long unstructured notes that genuinely need fuzzy recall (https://www.postgresql.org/docs/current/textsearch.html, `drizzle/0004_good_princess_powerful.sql:1-33`).
5. Keep code-gated writes and never let raw model prose become authoritative memory without validation (`AGENTIC_EXPANSIONV2.md:2604-2619`).

If you do only one thing, do this: finish `agent_memory_v2`, then promote `historicalSummary` from a one-off helper into a general canonical-summary pattern.

## Action Checklist
- [ ] Treat `AGENTIC_EXPANSIONV2.md` as the active spec, since `AGENTIC_EXPANSION.md` does not appear to exist here (`PRD.md:80`).
- [ ] Finish `agent_memory_v2` and the planned `memory.ts` / `context.ts` runtime before adding more retrieval machinery (`AGENTIC_EXPANSIONV2.md:1084-1085`, `AEV2_PLAN.md:102-109`).
- [ ] Define one canonical summary format for durable synthesized research, instead of keeping summaries as one-off per-feature JSON blobs (`lib/discord/client.ts:93-139`).
- [ ] Require stronger provenance on memory writes: source identifier, date, freshness rule, and whether the entry is fact vs thesis vs hypothesis (`AGENTIC_EXPANSIONV2.md:223-245`).
- [ ] Keep vector retrieval optional and secondary until you truly have a long unstructured corpus again (`AGENTIC_EXPANSIONV2.md:27`, `drizzle/0004_good_princess_powerful.sql:1-33`).

## Known Unknowns
- I do not see a shipped `agent_memory_v2` schema in `lib/db/schema.ts`, so implementation status may still change after this snapshot.
- Karpathy's LLM Wiki document is intentionally a pattern description, not a benchmarked reference architecture, so some design choices remain open by design.
- It is still unclear whether you want the future canonical-summary layer to be human-editable in app/admin UI, or only agent-maintained.
- The right amount of semantic retrieval depends on how large your research corpus gets. Right now the repo evidence suggests you were correct not to center the design on embeddings.

## Related Topics
- Symbolic vs semantic retrieval
- Context engineering for agents
- Provenance and evidence chains
- Checkpoint/resume design
- Research artifact schemas
- Task memory vs chat memory

## Follow-up Questions
1. Do you want me to design the smallest useful canonical-summary schema that fits on top of `agent_memory_v2`?
2. Do you want a follow-up focused only on provenance and freshness rules for research memory?
3. Do you want a follow-up comparing JSON-backed summaries vs markdown wiki pages for this exact app?

---
*To continue learning, use: `/research more about agent memory schema design` or ask follow-up questions*
