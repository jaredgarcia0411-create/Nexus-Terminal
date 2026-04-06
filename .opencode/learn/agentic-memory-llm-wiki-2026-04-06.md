# Agentic Memory, LLM Wiki, and Retrieval Design Crash Course
**Researched**: 2026-04-06
**Sources**: Karpathy gist, official framework docs, research papers, codebase analysis
**Context**: Codebase-specific research with practical recommendations for agent systems

---

## Concept Overview

Karpathy's "LLM Wiki" idea reframes memory as a compiled, editable knowledge layer instead of a query-time pile of retrieved chunks. The central move is to have the agent continuously maintain a structured wiki that sits between raw sources and downstream reasoning, so synthesis, cross-links, and contradictions accumulate over time instead of being rediscovered from scratch on every question.

In practice, this fits a broader pattern seen across modern agent-memory systems: raw data stays immutable, memory becomes a managed intermediate representation, and retrieval is only one part of the system. The strongest designs combine persistent artifacts, selective retrieval, reflection/consolidation, provenance, and explicit rules for when memory is written or revised.

## How It Works

Karpathy's pattern has three layers:

1. Raw sources: immutable inputs such as papers, docs, transcripts, datasets.
2. Wiki: LLM-maintained markdown pages containing summaries, entities, concepts, links, comparisons, and synthesized conclusions.
3. Schema: instructions that tell the agent how to ingest, update, query, and lint the wiki.

The key idea is that the agent does not merely index sources for future retrieval. It reads new material, updates existing pages, records contradictions, and compounds useful outputs back into the memory store. That makes memory editable and cumulative.

Related systems generalize this in a few ways:

- LangGraph separates short-term thread state from long-term memory stores and explicitly discusses semantic, episodic, and procedural memory.
- AutoGen exposes memory as a protocol with `add`, `query`, and `update_context`, treating memory as a first-class agent component.
- Letta/MemGPT argue that stateless RAG is insufficient and that agents need managed context, persistent state, and memory consolidation across time.
- Generative Agents shows that simple memory retrieval improves when paired with recency, importance, and reflection.

## How It Applies Here

This repo already leans toward structured, persistent memory rather than naive vector-RAG. `AGENTIC_EXPANSIONV2.md` explicitly says "No vector RAG in V1" and prefers SQL queries, API calls, and structured memory. `lib/db/schema.ts` defines an `agent_memory` table with category, key, JSON payload, and expiry fields. That means the repo is already aligned with a useful principle from LLM Wiki: memory should be explicit, persistent, and inspectable.

If you were building research-heavy agents here, the best fit would be:

- raw sources in immutable storage
- structured database memory for facts, watchlists, theses, and workflow state
- a markdown/wiki layer for synthesized research artifacts that humans can inspect and edit
- retrieval over both structured rows and wiki pages, not only embeddings

## Codebase Evidence

- `AGENTIC_EXPANSIONV2.md`: chooses structured memory and explicitly defers vector RAG.
- `lib/db/schema.ts`: defines persistent `agent_memory` rows with typed categories and expirations.
- `AGENTS.md`: warns that in-memory state is unreliable on Vercel, pushing persistent memory into DB or external stores.

## Key Principles

1. Memory should be a maintained artifact, not only a retrieval cache.
2. Keep raw evidence immutable and separate from synthesized memory.
3. Make memory editable. A good system must support updating, superseding, merging, and deleting stale beliefs.
4. Use layered memory: short-term context, long-term facts, episodic traces, and higher-level synthesized summaries.
5. Retrieval should be selective and multi-step. Search is not enough by itself.
6. Consolidation matters. Reflection, summarization, and contradiction handling are where compounding value comes from.
7. Provenance matters. Every memory worth trusting should point back to source material.
8. The memory format should be inspectable by humans, not hidden inside opaque embeddings alone.
9. Writing memory needs policy. Decide what gets stored immediately, what is background-processed, and what should never persist.
10. Retrieval quality depends on representation quality. Better memory objects often beat bigger vector stores.

## Best Practices

1. Treat the wiki or memory store as a compiled intermediate representation between raw data and answers.
2. Store provenance with every important claim: source URI, timestamps, hashes or versions when possible.
3. Separate fact storage from interpretation. Facts, hypotheses, summaries, and open questions should not be blended into one undifferentiated note.
4. Use background consolidation for heavy synthesis work so the online path stays fast.
5. Add memory linting: detect stale claims, orphaned pages, missing links, duplicate entities, and unresolved contradictions.
6. Prefer hybrid retrieval: lexical search, metadata filters, graph/wiki links, and semantic search where useful.
7. Keep memory scoped. Per-user, per-agent, per-domain namespaces prevent contamination.
8. Promote only durable information into long-term memory. Do not persist every chat turn.
9. Keep a path back to raw sources for deep verification and contested questions.
10. Evaluate memory systems on downstream task quality, not just retrieval recall.

## Common Pitfalls

**Pitfall**: Treating memory as just "chat history + embeddings."
**Why it fails**: It retrieves semantically similar text, but misses abstraction, contradiction tracking, and non-obvious relevance.
**Solution**: Add curated summaries, entity pages, and structured memory objects.

**Pitfall**: Letting the model freely rewrite memory without provenance.
**Why it fails**: Memory drift becomes invisible and false syntheses harden over time.
**Solution**: Track citations, versions, timestamps, and confidence.

**Pitfall**: Overstuffing context with retrieved text.
**Why it fails**: Context pollution hurts reasoning and wastes tokens.
**Solution**: Retrieve less, summarize aggressively, and use multi-step navigation.

**Pitfall**: Storing speculative reasoning as canonical memory.
**Why it fails**: Weak guesses become future premises.
**Solution**: Distinguish facts, hypotheses, and unanswered questions.

**Pitfall**: Using one global memory pool for everything.
**Why it fails**: Cross-task contamination and stale data.
**Solution**: Scope memory by user, agent, task, or domain, with expiry where appropriate.

**Pitfall**: Assuming a wiki alone scales indefinitely.
**Why it fails**: Search, deduplication, and maintenance costs grow with corpus size.
**Solution**: Add indexing, better retrieval tooling, and maintenance workflows as the corpus grows.

## Source List

1. Karpathy, "LLM Wiki" gist
URL: `https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f`
Credibility: High. Primary source for the concept from Andrej Karpathy; idea/spec, not a formal benchmarked framework.

2. LangGraph docs, "Memory overview"
URL: `https://docs.langchain.com/oss/python/langgraph/memory`
Credibility: High. Official framework documentation from a major agent framework; strong on practical memory taxonomy and write/read tradeoffs.

3. Microsoft AutoGen docs, "Memory and RAG"
URL: `https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/memory.html`
Credibility: High. Official Microsoft framework docs showing memory as an explicit agent protocol.

4. Mem0 docs, "Quickstart"
URL: `https://docs.mem0.ai/platform/quickstart`
Credibility: Medium-high. Official product docs; practical, though more implementation-oriented than theoretical.

5. Letta blog, "RAG is not Agent Memory"
URL: `https://www.letta.com/blog/rag-vs-agent-memory`
Credibility: Medium-high. Vendor-authored but thoughtful and directly relevant to when RAG is insufficient.

6. Letta blog, "Stateful Agents: The Missing Link in LLM Intelligence"
URL: `https://www.letta.com/blog/stateful-agents`
Credibility: Medium-high. Vendor-authored perspective on persistent state, context pollution, and memory consolidation.

7. Lilian Weng, "LLM Powered Autonomous Agents"
URL: `https://lilianweng.github.io/posts/2023-06-23-agent/`
Credibility: High. Widely cited technical synthesis; not official framework docs, but excellent quality and grounded in primary literature.

8. Packer et al., "MemGPT: Towards LLMs as Operating Systems"
URL: `https://arxiv.org/abs/2310.08560`
Credibility: High. Research paper introducing hierarchical/virtual context management for long-running agents.

9. Park et al., "Generative Agents: Interactive Simulacra of Human Behavior"
URL: `https://arxiv.org/abs/2304.03442`
Credibility: High. Influential research paper on memory retrieval with recency, importance, and reflection.

10. Lin et al., "Sleep-time Compute: Beyond Inference Scaling at Test-time"
URL: `https://arxiv.org/abs/2504.13171`
Credibility: High. Research paper relevant to offline consolidation and precomputation for repeated queries.

## Recommended Default Approach

For a practical agent system, use a layered memory design:

1. Immutable raw corpus.
2. Structured long-term memory in DB rows for facts, entities, state, and provenance.
3. Editable wiki or report layer for high-value syntheses.
4. Hybrid retrieval over metadata, lexical search, graph links, and semantic search.
5. Background consolidation jobs that rewrite summaries, merge duplicates, and flag contradictions.

This keeps the system inspectable and cheap at small scale, while still leaving room for stronger retrieval later.

## Concrete Opinion

LLM Wiki-style memory is not enough by itself for deep research or analysis tasks.

It is very good as a middle layer: a compiled, human-readable synthesis store that reduces repeated work and improves continuity. But deep research also needs direct access to raw evidence, provenance, selective retrieval, explicit contradiction management, and often multi-step verification or deliberation. A wiki alone can become a polished hallucination surface if the system does not continuously ground claims back to sources.

My view: LLM Wiki is an excellent memory substrate, but not a complete research architecture. For serious research/analysis, it should sit inside a broader system that includes raw-source traceability, structured memory, retrieval tools, and periodic review/recompilation.

## What These Systems Are Good At vs Weak At

Good at:

- ongoing topic tracking over weeks or months
- maintaining entity pages, timelines, comparisons, and summaries
- personalization and preference memory
- due diligence where the same corpus is queried repeatedly
- longitudinal research where synthesis should improve over time

Weak at:

- one-shot, high-stakes factual verification without source inspection
- rapidly changing domains unless freshness checks are strong
- adversarial or contested topics where disagreement must stay explicit
- very large corpora without better indexing/search infrastructure
- novel questions whose answer requires broad source traversal rather than previously consolidated notes

## Known Unknowns

- There is still no universally accepted best memory abstraction for agents. Current systems split across DB rows, vector stores, filesystems, graphs, and prompt-rewrite approaches.
- Benchmarks for "memory quality" still lag behind benchmarks for model quality.
- Vendor blogs are useful but naturally biased toward their own architecture choices.

## Follow-up Questions

- What is the smallest useful LLM Wiki schema for a single research domain?
- When should a memory write happen synchronously versus in a background job?
- How should provenance be encoded so a human can audit wiki claims quickly?

---
*To continue learning, ask follow-up questions about agent memory architecture, provenance design, or retrieval strategy.*
