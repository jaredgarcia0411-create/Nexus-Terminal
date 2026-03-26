# Modern RAG for LLM Agents Crash Course
**Researched**: 2026-03-26
**Sources**: Official vendor docs, vendor engineering posts, framework docs, codebase analysis
**Context**: Nexus Terminal-specific research on when retrieval helps agents vs when better prompts, tools, or structured context are enough

---

## Concept Overview
In 2025-2026, "RAG" is no longer just "put documents in a vector DB and stuff top-k chunks into the prompt." Modern practice splits retrieval into several patterns: classic document retrieval, tool-based retrieval, SQL/structured retrieval, memory retrieval, and agentic workflow context assembly. The best systems use the simplest one that matches the information need, then add evaluation, citations, filtering, and access control.

The biggest practical shift from 2023 advice is this: many agent systems do not need a general-purpose vector RAG stack at all. If the needed information is structured, fresh, user-specific, or reachable via a deterministic tool, direct retrieval is usually better than embedding everything first.

## How It Works
Modern retrieval systems usually separate five decisions:

1. **What kind of knowledge is needed?** Static docs, live APIs, SQL rows, user memory, or assembled workflow state.
2. **How should it be retrieved?** Keyword/vector/hybrid search, API call, SQL query, KV lookup, or orchestrated multi-step tool use.
3. **How should it be filtered?** Permissions, metadata, date range, tenant/user scope, and score thresholds.
4. **How should it be compressed?** Reranking, summarization, chunk expansion, or structured extraction.
5. **How should it be used?** Direct answer synthesis, citation-only support, planning context, or tool-selection context.

## How It Applies Here
Nexus Terminal already uses several retrieval patterns, but not classic document RAG as the main primitive:

- `lib/jarvis/context.ts` assembles **structured per-user context** from trades, macro summaries, and stored memory. This is agentic context assembly, not document RAG.
- `lib/jarvis/research.ts` does **tool/data retrieval** from AskEdgar, trims payloads, then asks the model for a TLDR. This is closer to tool-grounded generation than vector search.
- `lib/jarvis/memory.ts` stores compact behavioral facts keyed by user/category/key. That is **memory retrieval**, not a general knowledge base.
- `app/api/jarvis/chat/route.ts` chooses between chat, research, and trade-analysis workflows. That is a simple **routing/orchestration layer**.

For this repo, the research strongly suggests: keep using structured/tool retrieval for market, filing, and user-state questions. Add classic document RAG only if you later need search over large unstructured internal corpora such as reports, docs, or chat archives.

## Codebase Evidence
- `lib/jarvis/context.ts`: builds context from DB tables with explicit limits and recency windows.
- `lib/jarvis/research.ts`: trims AskEdgar API payloads before handing them to the model, which is retrieval + compression.
- `lib/jarvis/memory.ts`: persists user-specific insights as retrievable memory.
- `app/api/jarvis/chat/route.ts`: routes requests into chat, research, or analysis flows.

## Memo

### 1) What RAG is best at
- **Grounding answers in private or changing knowledge** when the model should cite or stay anchored to source material. Microsoft and Google both frame RAG mainly as grounding over private/fresh data rather than behavior tuning. URLs: https://learn.microsoft.com/en-us/azure/foundry/concepts/retrieval-augmented-generation , https://cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/rag-overview
- **Searching large unstructured corpora** that do not fit comfortably in a single prompt. Anthropic explicitly notes that if the corpus is small enough to fit in context, you may not need RAG at all. URL: https://www.anthropic.com/news/contextual-retrieval
- **Combining semantic recall with exact-match recall**. The current best-practice default is hybrid retrieval plus reranking, not dense-vector-only search. URLs: https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview , https://docs.pinecone.io/guides/search/hybrid-search
- **Providing provenance and citations** so users can inspect why the system answered a certain way. URLs: https://platform.openai.com/docs/guides/tools-file-search , https://learn.microsoft.com/en-us/azure/foundry/concepts/retrieval-augmented-generation
- **Reducing model staleness for reference questions** like policies, docs, filings, manuals, tickets, or research corpora.

### 2) Where RAG does NOT help much
- **Changing behavior, tone, or decision policy.** If the problem is "the model ignores instructions" or "the model writes in the wrong format," fix prompts, schemas, tool definitions, evals, or fine-tuning before adding retrieval. Microsoft explicitly separates RAG from fine-tuning for this reason. URL: https://learn.microsoft.com/en-us/azure/foundry/concepts/retrieval-augmented-generation
- **Deterministic business logic** such as entitlement checks, calculations, or workflow rules. Use code.
- **Fresh transactional data already in structured systems** like orders, balances, or rows keyed by user/date. SQL/API retrieval is usually better than embedding snapshots.
- **Small corpora that fit in context**. Anthropic says if the knowledge base is under about 200k tokens, prompt stuffing plus caching can be simpler and cheaper. URL: https://www.anthropic.com/news/contextual-retrieval
- **Tasks that mainly need tool execution** rather than fact lookup. For agents, sometimes the right move is "call the tool" not "search the docs about the tool."

### 3) Retrieval pattern differences
- **Classic document RAG**: retrieves chunks from indexed documents, usually via keyword/vector/hybrid search, then passes top results into generation. Best for large unstructured text corpora. Weakness: chunking, ambiguity, and stale indexes.
- **Tool-based retrieval**: the model calls a retrieval tool or API directly, such as web search, file search, CRM lookup, or an internal endpoint. Best when the source already has a trustworthy retrieval interface. OpenAI and Anthropic both increasingly present retrieval as one tool among many in agent systems, not the whole architecture. URLs: https://platform.openai.com/docs/guides/tools-file-search , https://www.anthropic.com/engineering/building-effective-agents
- **SQL retrieval**: queries structured tables and often returns rows or aggregates, sometimes with text-to-SQL. Best for exact filters, joins, metrics, user-specific data, and fresh operational state. LlamaIndex explicitly treats structured queries as a different QA pattern from semantic search. URL: https://docs.llamaindex.ai/en/stable/understanding/putting_it_all_together/q_and_a/
- **Memory retrieval**: fetches compact user-, session-, or task-specific state such as preferences, prior decisions, open loops, or learned patterns. Best when relevance is identity/time/task scoped, not corpus-wide similarity. In practice this is often KV/SQL retrieval, not vector search.
- **Agentic workflow context assembly**: the system gathers the right context by routing across tools, memories, APIs, SQL, and docs, then assembles only what the current step needs. Azure now calls this "agentic retrieval" when query planning fans out into subqueries; Anthropic frames it more broadly as workflows/agents using retrieval, tools, and memory together. URLs: https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview , https://www.anthropic.com/engineering/building-effective-agents

### 4) Common failure modes
- **Wrong retrieval type**: using vector search for data that should come from SQL/API/tool calls.
- **Chunk context loss**: relevant chunks lack document-level meaning. Anthropic's contextual retrieval work is a direct response to this. URL: https://www.anthropic.com/news/contextual-retrieval
- **Dense-only blind spots**: embeddings miss IDs, ticker symbols, error codes, legal citations, or jargon. Hybrid search fixes many of these misses. URLs: https://docs.pinecone.io/guides/search/hybrid-search , https://www.anthropic.com/news/contextual-retrieval
- **Too much retrieved context**: higher recall but lower answer quality because the model gets distracted or token budgets explode.
- **No reranking / poor ranking thresholds**: top-k contains near-matches instead of answer-bearing passages.
- **Bad corpus prep**: weak chunking, missing metadata, bad OCR, duplicates, stale content, or missing access-control tags.
- **Hallucination despite retrieval**: the model still infers beyond the evidence. Microsoft explicitly warns that grounding reduces but does not eliminate hallucination. URL: https://learn.microsoft.com/en-us/azure/foundry/concepts/retrieval-augmented-generation
- **Prompt injection from retrieved docs**: retrieved text is untrusted input and must not override system policy. URL: https://learn.microsoft.com/en-us/azure/foundry/concepts/retrieval-augmented-generation
- **No evals**: teams tune retrieval by vibes instead of testing retrieval recall, citation accuracy, and end-answer correctness.

### 5) What constraints/instructions can solve without RAG vs what retrieval is uniquely good at
- **Constraints/instructions can solve**: output format, refusal policy, tone, tool-use rules, when to ask clarifying questions, citation formatting, "say I don't know," and guardrails about not inventing missing fields.
- **Constraints/instructions can partly help but not replace retrieval**: telling the model to be up to date, to use company policy, or to remember a user preference that is not in context.
- **Retrieval is uniquely good at**: injecting facts the model does not already have in-context, accessing private/fresh/user-specific data, surfacing evidence and citations, narrowing a huge corpus to answer-bearing passages, and letting agents ground multi-step work in external state.
- **Simple rule of thumb**: if the missing problem is about *knowledge*, retrieval may help; if it is about *behavior*, retrieval usually is not the fix.

## Best Practices
1. Default to the **simplest retrieval primitive** that matches the data shape: SQL/API/KV first, document RAG second, agentic fan-out last.
2. For document RAG, default to **hybrid retrieval + metadata filters + reranking + citations**.
3. Treat **retrieved text as untrusted input** and keep policy in system instructions/tool contracts, not documents.
4. Evaluate separately for **retrieval quality** and **answer quality**.
5. Add agentic retrieval only when single-query retrieval measurably misses multi-hop or ambiguous questions.

## Common Pitfalls
**Pitfall**: Building vector RAG because "agents need memory."  
**Solution**: Use explicit memory stores for user/session/task state first.

**Pitfall**: Embedding operational tables.  
**Solution**: Query structured systems directly and optionally summarize results for the model.

**Pitfall**: Using retrieval to fix weak prompts.  
**Solution**: Tighten instructions, schemas, tools, and evals before adding more context.

## Recommended Default Approach
For most 2025-2026 agent systems, start with **workflow context assembly over deterministic sources**: SQL for structured state, APIs/tools for live data, lightweight memory for user/task state, and classic document RAG only for large unstructured corpora. Add multi-query/agentic retrieval only after evals show single-query retrieval is the bottleneck.

## Decision heuristics for whether a system needs RAG
- Use **no RAG** if the corpus is small enough to fit in prompt context, the task is mostly behavior/policy, or the answer should come from code/tool logic.
- Use **SQL/API/tool retrieval instead of document RAG** if the truth lives in structured or live systems.
- Use **classic document RAG** if users ask questions over a large unstructured corpus and need grounded answers with citations.
- Use **memory retrieval** if the missing context is user-, session-, or task-specific rather than document search.
- Use **agentic context assembly / agentic retrieval** if queries are ambiguous, multi-hop, or span multiple sources and a single retrieval step underperforms on evals.
- If you cannot define the source of truth, expected citations, or success metrics, you probably do **not** yet have a RAG problem; you have a product-definition/evals problem.

## Known Unknowns
- Vendor docs agree on the broad direction, but "agentic retrieval" remains vendor-specific and partly preview in some platforms, so implementation details vary.
- Public docs are stronger on document retrieval than on long-term memory architectures; many production memory systems are still custom.

## Related Topics
- Context engineering for agents
- RAG evaluation design
- Text-to-SQL guardrails
- Prompt injection defenses for retrieval systems

## Follow-up Questions
- How should you evaluate retrieval separately from answer generation?
- When should memory be vectorized versus keyed by explicit slots?
- When is fine-tuning better than retrieval for agent products?

---
*To continue learning, use: `/research more about RAG evals` or ask follow-up questions*
