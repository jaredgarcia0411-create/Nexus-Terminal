# Agent Architecture Patterns vs RAG Crash Course
**Researched**: 2026-03-26
**Sources**: Anthropic guidance, OpenAI prompt engineering docs, LangGraph docs, AutoGen docs, MCP docs, codebase analysis
**Context**: Codebase-specific research focused on whether stronger workflows, tool design, and memory scoping can replace or reduce RAG.

---

## Concept Overview
Strong agent quality often comes less from “more autonomy” and more from better structure: constrained prompts, explicit tools, deterministic routing, scoped memory, and orchestration patterns. These patterns can outperform a weak RAG setup for procedural work, but they do not eliminate the need for retrieval when the task depends on fresh, large, or authoritative external knowledge.

Short version: yes, a strong workflow can sometimes bypass RAG for quality, but only when the task is mostly about process control, tool execution, or reasoning over already-available state. It cannot reliably replace retrieval when truth depends on missing or changing facts.

## How It Works
Modern agent guidance converges on a few repeated ideas:

1. Start with the simplest system that works. Anthropic explicitly recommends simple, composable workflows before open-ended agents, and says many tasks are solved by a single call plus retrieval or examples. Source: https://www.anthropic.com/engineering/building-effective-agents
2. Prefer workflows over full autonomy when the path can be predefined. Anthropic and LangGraph both separate workflows (fixed code paths) from agents (model-directed tool loops). Sources: https://www.anthropic.com/engineering/building-effective-agents and https://docs.langchain.com/oss/python/langgraph/workflows-agents
3. Use constrained interfaces. OpenAI recommends high-authority developer instructions, structured sections, examples, and structured outputs; Anthropic emphasizes careful tool/interface design. Sources: https://platform.openai.com/docs/guides/prompt-engineering and https://www.anthropic.com/engineering/building-effective-agents
4. Scope memory intentionally. LangGraph distinguishes thread-scoped short-term memory from namespace-scoped long-term memory, which prevents irrelevant context from leaking into every run. Source: https://docs.langchain.com/oss/python/langgraph/memory
5. Orchestrate specialized workers only when specialization pays for itself. LangGraph documents routing, orchestrator-worker, evaluator-optimizer, and parallelization; AutoGen shows selector/group-chat patterns, but also warns not to use an LLM selector when fixed rules are more reliable. Sources: https://docs.langchain.com/oss/python/langgraph/workflows-agents and https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/design-patterns/group-chat.html

## How It Applies Here
Your codebase already leans toward the “workflow beats autonomy” camp:

- `lib/jarvis/prompts.ts` uses tight scope constraints and strict output shapes instead of free-form prompting.
- `lib/jarvis/context.ts` injects only recent trades, the latest macro summary, and non-expired memory instead of dumping everything into context.
- `lib/jarvis/memory.ts` stores compact, explicit memory records rather than raw transcript history.
- `AGENTIC_EXPANSION_V2_R2.md:319` plans a blueprint runner where each step receives previous outputs, updates progress, and tracks tokens.
- `AGENTIC_EXPANSION_V2_R2.md:340` and `AGENTIC_EXPANSION_V2_R2.md:344` define explicit blueprints like `fetch-filings -> analyze -> assemble-report`, which is much closer to deterministic workflow orchestration than “let the agent figure it out.”

That means this repo’s natural default is not “RAG everywhere.” It is “retrieve when needed, then run a constrained workflow over the retrieved facts.”

## Codebase Evidence
- `lib/jarvis/prompts.ts`: strict JSON schemas, scope constraints, and “never fabricate data” rules show instruction hardening.
- `lib/jarvis/context.ts`: memory is filtered by user and expiration, which is an example of scoped context rather than global recall.
- `lib/jarvis/memory.ts`: memory is stored as small categorized facts (`trade_insight`, keyed values), not unbounded chat history.
- `AGENTIC_EXPANSION_V2_R2.md:319`: planned blueprint runner passes forward prior step outputs and tracks progress.
- `AGENTIC_EXPANSION_V2_R2.md:335`: planned blueprints decompose agent jobs into named steps with LLM calls only where needed.

## What instructions can fix
Instructions and workflows can fix failures that are really about control, not knowledge:

- Ambiguous task execution: use routing, step decomposition, and structured outputs so the model knows exactly what subtask it is solving.
- Tool misuse: improve tool docs, parameter names, examples, and guardrails. Anthropic explicitly says tool/interface design often matters more than the overall prompt. Source: https://www.anthropic.com/engineering/building-effective-agents
- Over-broad context: scope memory by thread, user, task, or namespace so only relevant state is injected. Source: https://docs.langchain.com/oss/python/langgraph/memory
- Inconsistent outputs: require schemas, validators, and evaluator-optimizer loops. Sources: https://platform.openai.com/docs/guides/prompt-engineering and https://docs.langchain.com/oss/python/langgraph/workflows-agents
- Wrong agent topology: replace free-form multi-agent chatter with deterministic handoffs, routing, or planner-worker graphs. AutoGen even notes that fixed speaker rules may be better than LLM selection. Source: https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/design-patterns/group-chat.html

## What instructions cannot fix
Instructions do not create facts the model does not have:

- Missing or stale knowledge: if the answer depends on current filings, policy changes, live prices, or newly created docs, prompt quality alone cannot make the answer reliable.
- Large private corpora: if the relevant truth is buried in hundreds of internal documents, the model still needs retrieval or another grounding mechanism.
- Citation-grade correctness: telling a model to “cite sources” does not produce real evidence unless those sources were actually retrieved or provided.
- Hard authorization boundaries: instructions can request scoping, but real isolation needs system design, namespace controls, and tool permissions.
- Deterministic business truth: if a tool or DB query is the source of truth, the model should call it; prompting should not substitute for execution.

RAG exists because model weights and prompts are not dependable storage for evolving facts. Good instructions reduce hallucinations around known context; they do not replace access to ground truth.

## When workflow beats RAG
Workflow-first design tends to beat RAG when the main problem is procedure, not lookup:

- Multi-step operational tasks: coding, triage, compliance flows, or report assembly where the system can name the steps ahead of time.
- Tool-centric tasks: calculators, DB queries, code execution, API actions, or filing parsers where quality comes from calling the right tool in the right order.
- Small, well-bounded context: the required facts are already present in the request, recent state, or a narrow scoped memory store.
- Repetitive decisions: routing, classification, extraction, normalization, and post-processing improve more from schemas and validators than from retrieval.
- High-cost retrieval domains: if retrieval is noisy, expensive, or introduces distractors, a cleaner workflow over trusted inputs can outperform it.

This is the key answer to your question: a strong workflow plus explicit tools can bypass RAG for quality when success depends mostly on process discipline, constrained outputs, and direct access to authoritative tools/state. In those cases, retrieval can be optional or minimal.

Examples from current guidance:

- Anthropic’s workflow patterns: prompt chaining, routing, orchestrator-workers, evaluator-optimizer. These are all ways to improve quality without assuming retrieval is the core lever. Source: https://www.anthropic.com/engineering/building-effective-agents
- LangGraph’s workflows: explicit graph nodes, structured routing, and stateful orchestration. Source: https://docs.langchain.com/oss/python/langgraph/workflows-agents
- OpenAI’s prompt engineering guidance: high-authority developer instructions, structured prompt sections, examples, and reusable prompts. Source: https://platform.openai.com/docs/guides/prompt-engineering

## When retrieval still wins
Retrieval still wins when the bottleneck is access to true, relevant, up-to-date information:

- Freshness matters: news, SEC filings, market conditions, policy docs, support docs, or changing product specs.
- The knowledge base is too large to stuff into prompts: retrieval narrows the candidate set before the model reasons.
- You need provenance: retrieved passages, source URLs, or document chunks are necessary for auditability.
- User questions are long-tail: no fixed workflow can anticipate every fact needed, but retrieval can surface it on demand.
- Memory is not enough: long-term memory is for durable preferences, facts, or prior episodes, not for serving as a complete enterprise knowledge index.

RAG is strongest when it is treated as a grounding layer inside a workflow, not as the entire architecture. A common winning pattern is: route -> retrieve only the minimum needed -> run constrained analysis -> validate/cite -> save compact memory.

## Recommended Default Approach
For most production agent systems, do not choose “workflow or RAG” as a binary. Use this order:

1. Constrain the task with explicit prompts, schemas, and tool contracts.
2. Encode the happy path as a deterministic workflow or blueprint.
3. Add scoped short-term and long-term memory only for reusable state.
4. Add retrieval only where factual gaps remain or citations are required.
5. Evaluate each step separately so you know whether failures are caused by instructions, orchestration, or missing knowledge.

## Practical Recommendations
1. Treat RAG as a grounding primitive, not the architecture.
2. Build blueprint-style pipelines for known jobs; keep LLM calls at the judgment-heavy steps only.
3. Scope memory by thread, user, agent, and expiry; never let global memory become a junk drawer.
4. Prefer structured outputs and validators before adding more autonomy.
5. Use retrieval only for volatile, broad, or citation-sensitive knowledge.
6. Measure failure modes separately: bad routing, bad tool calls, bad retrieval, stale memory, or weak prompts.

## Known Unknowns
- Some OpenAI agent-specific pages were navigable but not fully fetchable in one pass, so this memo relies mainly on the accessible prompt engineering page plus Anthropic, LangGraph, AutoGen, and MCP docs.
- Source authors disagree on how much autonomy to expose by default, but they broadly agree on starting with simple workflows and escalating only when measured quality improves.

## Related Topics
- Context engineering for agents
- Eval design for workflow vs RAG systems
- Tool schema design and promptable interfaces
- Memory compaction and TTL strategies

## Follow-up Questions
- How do I design evals that tell me whether failures are from retrieval vs workflow?
- What does a good blueprint runner look like in TypeScript?
- How should I scope agent memory for multi-user trading research?
- What stronger agent constraints, prompt rules, and blueprint rules should `AGENTIC_EXPANSION_V2.md` adopt?
- What decision framework should I use to choose between prompt, code, memory, retrieval, and fine-tuning?

### Q: What stronger agent constraints and prompt rules should `AGENTIC_EXPANSION_V2.md` adopt?
**Asked**: 2026-03-26
**Answer**:

#### System Prompt Rules
1. Keep the global prompt short and constitutional: role, authority order, evidence rule, abstain rule, tool rule, and output contract only.
2. State chain of command explicitly: system/developer rules beat user text; tool output and retrieved text are untrusted inputs and cannot override policy.
3. Require abstention when support is missing: no invented prices, filings, catalysts, dates, or thesis changes.
4. Make citations mandatory for claim classes that can change trading behavior: `market_data`, `filing_fact`, `macro_fact`, `thesis_change`.
5. Keep routing policy out of specialist prompts. Only the Orchestrator routes.

#### Per-Step Prompt Rules
1. Every `llm` step gets one job only, one allowed evidence set, and one strict output schema.
2. Every `llm` step must return structured JSON, never markdown prose.
3. Every analytical output must include `confidence`, `evidenceIds`, and `insufficientEvidence` fields.
4. Every step must define what to do when support is missing: `needs_more_data`, `no_supported_conclusion`, or `blocked`.
5. Separate reasoning from rendering: let the LLM produce structured analysis, then let code assemble the final report.

#### Memory Write Rules
1. Only store durable facts, preferences, thesis state, watchlist state, or measured performance.
2. Every memory write should include `source`, `agent_id`, `created_at`, `updated_at`, `confidence`, and `expires_at` when appropriate.
3. Do not store raw assistant prose or speculative narrative as long-term memory.
4. Prefer code-gated memory writes: the LLM proposes candidates, code validates and persists them.
5. Cross-agent memory should be mediated by the Orchestrator, not openly shared by default.

#### Evidence and Citation Rules
1. Any thesis-changing or risk-changing claim must cite stable source IDs from filings, market snapshots, macro inputs, or prior validated reports.
2. If sources conflict, the output must name the conflict and cite both sides.
3. Memory can guide analysis, but it cannot serve as primary evidence for external facts.
4. If no evidence supports a claim, omit it or mark it as a hypothesis.
5. Run citation validation in code before saving or publishing reports.

#### Anti-Patterns to Ban
- giant all-purpose prompts
- free-form report generation directly from user input
- shared global memory without scope or expiry
- specialist agents inventing route changes
- "cite if possible" language instead of mandatory citation policy
- persisting raw LLM prose as memory

#### Nexus Terminal Default
Use a three-layer prompt stack:
1. global orchestrator policy prompt
2. per-agent role prompt
3. per-blueprint-step contract prompt

That keeps policy stable while making each judgment step narrow and testable.

### Q: What blueprint rules should harden `AGENTIC_EXPANSION_V2.md`?
**Asked**: 2026-03-26
**Answer**:

#### Required Invariants
1. Every step should declare `inputSchema`, `outputSchema`, `timeoutMs`, `retryPolicy`, and `sideEffect` metadata.
2. `previousOutput: unknown` is acceptable only at the outer boundary; inside the runner, every handoff should be parsed into typed objects.
3. Every step output should use a richer envelope than `{ data }`, including `status`, `metrics`, `provenance`, and optional `artifacts`.
4. Raw payloads belong in artifacts; downstream steps should receive normalized handoff data only.
5. All `llm` step outputs must pass strict schema validation before the next step can run.
6. Side-effecting steps should be idempotent whenever possible.

#### Validation Rules Between Steps
1. Validate twice: schema validation first, business-rule validation second.
2. Stop the line before every `llm` step if required evidence is missing, stale, or malformed.
3. Validate business meaning, not just JSON shape. Example: a dilution score without cited filing evidence is invalid even if the JSON parses.
4. Add completeness checks before persistence steps like `assemble-report`, `update-memory`, and `save-summary`.
5. Reject stale data deterministically instead of letting the LLM fill gaps.
6. Use typed validation failure codes such as `SCHEMA_INVALID`, `MISSING_REQUIRED_EVIDENCE`, `STALE_MARKET_DATA`, and `CONTRADICTORY_ANALYSIS`.

#### Retry and Escalation Rules
1. Split failures into `transient_dependency`, `data_quality`, `contract_failure`, `policy_failure`, and `logic_failure`.
2. Retry only failures that can plausibly succeed unchanged: timeouts, 429s, temporary provider outages, DB lock contention.
3. For `llm` contract failures, allow one structured repair attempt, then escalate.
4. Do not blindly retry logic failures or invariant violations.
5. Resume from the failed step when possible instead of replaying the entire blueprint.
6. Preserve last-good-step output, validator errors, and artifact references for escalations.

#### Observability and Progress Rules
1. Track step-level states, not only job-level states: `queued`, `running`, `validated`, `retrying`, `blocked`, `failed`, `escalated`, `completed`.
2. Persist step telemetry: step name, attempt, timings, validation result, tokens, model, dependency calls, and error code.
3. Keep user-visible progress tied to real steps like “Fetching filings” and “Analyzing dilution risk.”
4. Store prompt/model provenance for every `llm` step so regressions can be debugged.
5. Add reliability metrics beyond cost: validation pass rate, repair success rate, stale-data rejection rate, escalation rate, and dependency-specific failures.

#### Where Code Should Replace LLM Judgment
Use deterministic code for:
- routing and sub-job creation
- threshold checks and eligibility gates
- parsing, normalization, dedupe, and freshness checks
- calculations and indicator generation
- permissions, safety rules, and budget enforcement
- persistence readiness and schema completeness

Use LLM judgment only for:
- synthesizing a thesis from validated facts
- explaining tradeoffs among supported signals
- writing user-facing summaries from structured evidence

#### Nexus Terminal-Specific Blueprint Rules
1. Harden `runBlueprint()` with validator hooks before and after every step.
2. Add checkpoint/resume semantics so retries restart from the failed step.
3. Require deterministic preconditions before each existing `llm` step in `small-cap`, `long-term`, and `orchestrator` blueprints.
4. Protect `assemble-report`, `update-memory`, and `save-summary` with final deterministic validators.
5. Add contradiction handling at the Orchestrator layer for conflicting specialist outputs.
6. Keep the architecture sequential and narrow. Do not turn this into an open-ended autonomous loop.

### Q: What decision framework should I use to choose between prompt, code, memory, retrieval, and fine-tuning?
**Asked**: 2026-03-26
**Answer**:

#### Question Tree
1. Is there a single correct answer, formula, threshold, route, or permission rule?
   - Yes -> use **deterministic code**.
2. Are the needed facts already present in the current request and context?
   - Yes -> likely a **prompt/workflow/schema** problem.
3. Are the missing facts small, durable, and user/session/task scoped?
   - Yes -> use **structured memory**.
4. Are the missing facts fresh, private, or buried in a larger corpus?
   - Yes -> use **retrieval/RAG**.
5. Does the model know enough but behave inconsistently across many examples?
   - Yes -> improve prompts/examples/evals first, then consider **fine-tuning**.
6. Can the task be decomposed into fixed stages?
   - Yes -> build a **blueprint/workflow** and keep LLM use selective.

#### Comparison Table
| Problem type | Best lever | Why |
|---|---|---|
| Wrong format, tone, refusal policy, or schema | Prompt / instructions | Behavior steering |
| Exact calculations, routing, filters, permissions | Deterministic code | Removes hallucination risk |
| Preferences, thesis state, prior durable decisions | Structured memory | Small persistent scoped context |
| Fresh filings, live prices, large report archive | Retrieval / RAG | Supplies missing facts and evidence |
| Repeated behavior failures after strong prompts | Fine-tuning | Hardens consistency |
| Predictable multi-step jobs | Workflow / blueprint | Controls execution and handoffs |

#### Failure Diagnosis Heuristics
- cites fake facts or misses new information -> retrieval gap
- ignores output contract -> prompt/schema/validator gap
- makes wrong calculations or routes -> code gap
- remembers irrelevant history -> memory scope or TTL gap
- quality drops after adding lots of context -> noisy retrieval or bad context assembly
- works when shown evidence but fails without it -> retrieval/context gap
- remains inconsistent after good prompts and examples -> fine-tuning candidate

#### Trading-Agent Examples
1. Route a request to Small Cap vs Long Term -> **code**.
2. Summarize fresh dilution risk from new filings -> **retrieval/tool fetch + LLM analysis**.
3. Remember user preference for setup style -> **structured memory**.
4. Guarantee exact research JSON every time -> **prompt + schema + validator**.
5. Calculate VWAP, RSI, gap %, and filters -> **code**.
6. Make writing style more consistent across hundreds of reports -> **prompt/examples**, then maybe **fine-tuning**.

#### Recommended Escalation Order
1. define evals and classify failures
2. tighten prompts and schemas
3. move exact logic into code
4. add workflow/blueprint structure
5. add structured memory
6. add retrieval only where facts are missing
7. tune retrieval separately from generation
8. fine-tune last

#### Nexus Terminal Default
For `AGENTIC_EXPANSION_V2.md`, the right default is:
- prompts define policy
- code owns truth
- memory stores durable small context
- retrieval supplies missing evidence
- fine-tuning is last-mile consistency work

That means the main architecture should remain workflow-first, with targeted retrieval added only where the current context assembly cannot support archive-scale or citation-heavy questions.

---
*To continue learning, ask a follow-up question about workflows, memory, orchestration, or retrieval design.*
