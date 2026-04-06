# Open-source Agent Memory Patterns Relevant to LLM Wiki vs Spec-driven Agent Memory Systems Crash Course
**Researched**: 2026-04-06
**Sources**: Official docs, open-source project docs, papers, codebase analysis
**Context**: Recommendations tailored to Nexus Terminal's planned agent runtime

---

## Concept Overview
Agent memory is no longer treated as one thing. The best current systems separate short-term thread state, durable long-term memory, and task artifacts, then retrieve each differently. The real design question is not "should I add memory?" but "which memory shape belongs to which job?"

## How It Works
The main open-source patterns cluster into a few families:

1. Append-only event memory: store observations, actions, and outcomes as immutable records, then summarize or retrieve later.
2. Editable canonical memory: maintain a current profile, wiki page, or memory block that can be patched over time.
3. Retrieval memory: search memories by vector similarity, metadata filters, or explicit keys.
4. Task memory: persist plans, specs, checkpoints, and outputs separately from chat history.

Recent systems increasingly mix these instead of choosing only one.

## How It Applies Here
For this repo, a pure "LLM wiki" is too loose by itself, and a pure append-only log is too noisy by itself.

The repo's planned agent system is already spec-oriented:
- `AEV2_PLAN.md:102` requires memory reads/writes via `agent_memory_v2` and separate context assembly.
- `AEV2_PLAN.md:103-104` separates blueprint execution from checkpoint/resume.
- `AGENTS.md:60` explicitly warns that in-memory state is unreliable on Vercel, pushing durable state into DB/external storage.

That points toward a hybrid design:
- append-only event log for audits and replay
- structured task/project memory for agent context assembly
- a small editable "wiki/profile" layer for stable facts and operator preferences
- retrieval that is primarily symbolic/filtered first, with vector search only as a secondary aid

## Codebase Evidence
- `AEV2_PLAN.md:102-104`: memory/context, blueprint runner, and checkpoint/resume are already separated conceptually.
- `AEV2_PLAN.md:118`: admin memory endpoints imply memory is a first-class persisted surface, not hidden prompt state.
- `AGENTS.md:60`: durable external persistence is required because Vercel cannot be trusted for process memory.
- `HANDOFF.md:49-58`: this repo already works from explicit specs/handoffs, which is closer to task memory than chat-summary memory.

## Structured Comparison

### 1. Append-only Logs vs Editable Wiki Memory

**Append-only log**
- Pattern: store every event, observation, tool result, or reflection as immutable records.
- Seen in: Generative Agents memory stream plus reflection/retrieval; many LangGraph and agent-runtime checkpoint systems.
- Strengths:
- strong audit trail
- easy debugging and replay
- safer for multi-agent concurrency
- good raw material for later summaries
- Weaknesses:
- retrieval quality degrades as logs grow
- lots of low-signal entries
- agents can re-surface stale or contradictory facts

**Editable wiki/profile**
- Pattern: maintain a current canonical memory document or blocks that can be updated.
- Seen in: LangGraph `patch` memory schema, Letta memory blocks, many "profile" memory systems.
- Strengths:
- compact context
- easier to inject into prompts reliably
- good for preferences, definitions, stable facts, operating rules
- Weaknesses:
- harder provenance
- risk of bad edits overwriting truth
- schema drift or hallucinated updates can silently corrupt memory

**Practical tradeoff**
Use logs for truth and auditing. Use wiki/profile memory for currently trusted distilled facts. Do not make the wiki the only source of record.

### 2. Vector Retrieval vs Symbolic/Structured Retrieval

**Vector retrieval**
- Pattern: embed memories and retrieve by semantic similarity.
- Seen in: AutoGen vector memory, LangGraph store semantic search, many RAG-style memory systems.
- Strengths:
- useful when wording varies
- good for fuzzy recall across large unstructured notes
- helpful for research snippets and prior analyses
- Weaknesses:
- poor determinism
- hard to know why an item was returned
- can miss exact critical records that should have matched by key
- often weak for operational state like "latest approved spec" or "open task 17"

**Symbolic/structured retrieval**
- Pattern: query by namespace, keys, entity IDs, tags, type, timestamps, status, or relations.
- Seen in: LangGraph namespaced stores, Letta memory blocks, spec/task tables, checkpoint systems.
- Strengths:
- predictable and debuggable
- better for tasks, workflows, checkpoints, and permissions
- easier to reason about for small private systems
- Weaknesses:
- requires schema design upfront
- weaker for fuzzy recall across free text

**Practical tradeoff**
For operator workflows and research jobs, symbolic retrieval should be the default. Add vector retrieval only for notes/artifacts where semantic similarity is genuinely useful.

### 3. Conversation Summaries vs Task/Project Memory

**Conversation summaries**
- Pattern: compress prior chat into a rolling summary.
- Strengths:
- cheap context compression
- improves continuity for chat UX
- Weaknesses:
- loses decision provenance
- easy to drop edge constraints
- summaries often blend facts, assumptions, and stale plans

**Task/project memory**
- Pattern: persist objectives, specs, checkpoints, decisions, outputs, blockers, and artifacts as separate records.
- Strengths:
- far better for long-running work
- survives across threads and agents
- maps cleanly to execution systems and admin tooling
- Weaknesses:
- more tables or schemas
- requires lifecycle rules

**Practical tradeoff**
Deep research/analysis agents usually need task memory more than chat summary memory. Summaries help, but they should summarize a task state, not replace it.

### 4. Per-agent Memory vs Shared Team Memory

**Per-agent memory**
- Strengths:
- specialization stays clean
- lower cross-agent contamination
- easier safety boundaries
- better when agents have different prompts and jobs
- Weaknesses:
- duplicated facts
- harder handoff between agents

**Shared team memory**
- Strengths:
- supports coordination and reuse
- avoids repeated work
- central source for approved facts/artifacts
- Weaknesses:
- contention, overwrite risk, and ambiguity over authority
- more need for provenance and access rules

**Practical tradeoff**
The common winning pattern is layered memory: private working memory per agent, plus shared artifact memory for approved outputs.

## Best-Practice Shifts
1. From "chat history as memory" to explicit memory layers. LangGraph, Letta, and modern agent runtimes separate thread state from durable memory.
2. From hot-path memory writes to background/debounced writes. LangGraph's memory template explicitly recommends asynchronous memory formation to reduce latency and duplication.
3. From pure vector DB thinking to hybrid retrieval. Recent systems treat vectors as one retrieval tool, not the entire memory architecture.
4. From user-preference memory only to task-aware memory. Open-source work increasingly distinguishes semantic facts, episodic traces, and procedural instructions.
5. From monolithic memory to typed memory schemas. Patchable profile docs plus appendable note/event collections is becoming a practical default.

## Open-source Patterns Worth Copying
1. **LangGraph memory split**: thread checkpoints plus namespaced long-term store; good base model for production agents. Source: LangGraph memory docs and memory-template.
2. **LangGraph patch + insert schemas**: one canonical profile plus appendable notes; very relevant to wiki vs log design. Source: `langchain-ai/memory-template`.
3. **MemGPT / Letta stateful memory**: pinned core memory in context plus durable archived messages outside context; best when agents run for long periods and need editable core memory. Sources: MemGPT paper/site, Letta docs.
4. **Generative Agents**: append-only memory stream plus reflection summaries and retrieval scoring; useful for research traces and derived insights. Source: Park et al. 2023.
5. **AutoGen memory protocol**: memory as pluggable store injected before steps; useful architectural seam even if the example memories are simple. Source: AutoGen memory docs.

## Recommended Default Approach
For a small private system like this repo:

1. Keep an **append-only event log** for every job/step/tool result/checkpoint.
2. Add **structured task memory** keyed by `job_id`, `agent_id`, `ticker`, `report_type`, `status`, and timestamps.
3. Add a very small **editable wiki/profile layer** only for stable facts:
- operator preferences
- agent operating rules
- durable entity summaries
- approved market/ticker notes
4. Use **symbolic retrieval first** for context assembly.
5. Use **vector retrieval second** only over research artifacts, long notes, and prior reports.
6. Generate **summaries as derived views**, not as the authoritative memory source.
7. Separate **per-agent scratch memory** from **shared approved memory**.

## When Each Approach Makes Sense
- Use mostly append-only logs when you need replayability, evaluation, and incident debugging.
- Use editable wiki memory when facts must stay short, current, and easy to inject every run.
- Use vector retrieval when the corpus is large and unstructured, especially prior research text.
- Use structured retrieval when the system has explicit entities, tasks, and workflow state.
- Use shared memory when outputs need reuse across agents.
- Use private memory when agents have different roles or should not inherit each other's tentative reasoning.

## What Deep Research Agents Usually Need
For deep research/analysis, the usual minimum bundle is:
- short-term thread state
- append-only execution/history log
- structured task/project memory
- artifact store for reports, notes, citations, and extracted facts
- small editable canonical memory for trusted durable facts
- optional vector retrieval over artifacts

Simple chat assistants can get away with profile memory plus summaries. Research agents usually cannot.

## Common Pitfalls
**Pitfall**: treating vector search as the whole memory system.
**Solution**: use vectors for fuzzy recall, not for authoritative workflow state.

**Pitfall**: letting agents freely rewrite canonical memory without review or provenance.
**Solution**: keep source links, writer identity, timestamps, and possibly human approval for promoted facts.

**Pitfall**: using conversation summaries as a substitute for task state.
**Solution**: store decisions, blockers, outputs, and checkpoints in typed records.

## Known Unknowns
- "LLM wiki" is not one standardized architecture term; in practice it overlaps with profile memory, editable memory blocks, and canonical knowledge pages.
- Best retrieval mixes still vary by workload; most sources agree on hybrid memory, but not on one universal ratio of structured vs vector recall.

## Sources
- LangChain/LangGraph docs, "Memory overview": https://docs.langchain.com/oss/python/concepts/memory
- LangGraph memory concepts: https://langchain-ai.github.io/langgraph/concepts/memory/
- LangGraph memory template: https://github.com/langchain-ai/memory-template
- MemGPT paper/site: https://research.memgpt.ai/ and https://arxiv.org/abs/2310.08560
- Letta memory docs: https://docs.letta.com/guides/agents/memory
- Microsoft AutoGen memory docs: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/memory.html
- CoALA paper: https://arxiv.org/abs/2309.02427
- Generative Agents paper: https://arxiv.org/abs/2304.03442

## Follow-up Questions

---
*To continue learning, ask follow-up questions on schema design, retrieval design, or how to map this into `agent_memory_v2`.*
