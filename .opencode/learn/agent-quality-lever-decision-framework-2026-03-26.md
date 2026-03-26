# Agent Quality Lever Decision Framework
**Researched**: 2026-03-26
**Sources**: OpenAI, Anthropic, Microsoft Foundry, Google Vertex AI, LangGraph, Pinecone, codebase analysis
**Context**: Practical framework for choosing between prompts/instructions, deterministic code, structured memory, retrieval/RAG, and fine-tuning while designing `AGENTIC_EXPANSION_V2.md`

---

## Concept Overview
Teams usually get better agent quality by fixing the *actual bottleneck* instead of reaching for the fanciest lever. The cleanest split from current guidance is: use prompts, schemas, and workflows for **behavior/control** problems; use retrieval and memory for **missing context** problems; use deterministic code for **truth and rules**; use fine-tuning only when the behavior must become consistently learned across many examples.

OpenAI explicitly frames optimization as choosing the right lever for either context or behavior, not following a rigid ladder. Anthropic and LangGraph both push the same practical idea: start with simple workflows and augmentations, then add complexity only when evals prove it helps.

## How It Works
Think of the five levers like this:

- **Prompt / instructions**: teach the model what to do right now.
- **Deterministic code**: remove judgment from anything with a correct answer, fixed routing rule, or exact calculation.
- **Structured memory**: save compact user/task facts that should persist across turns or sessions.
- **Retrieval / RAG**: fetch external facts the model does not currently have, especially private, fresh, or large-corpus knowledge.
- **Fine-tuning**: teach a behavior pattern so the model performs it more consistently and cheaply across many requests.

The most useful diagnostic question is: is the failure mainly about **behavior**, **knowledge**, or **control**?

## How It Applies Here
Your repo already leans toward a strong default:

- `lib/jarvis/prompts.ts` uses strict scope rules, schemas, and anti-fabrication instructions.
- `lib/jarvis/context.ts` injects bounded context instead of dumping everything into the prompt.
- `lib/jarvis/memory.ts` stores compact keyed facts, which is structured memory rather than transcript stuffing.
- `AGENTIC_EXPANSION_V2.md:335` defines blueprint steps as either `code` or `llm`.
- `AGENTIC_EXPANSION_V2.md:418`-`AGENTIC_EXPANSION_V2.md:464` already decomposes trading jobs into deterministic fetch/calc steps and LLM judgment steps.

That means the natural architecture for Nexus Terminal is: **deterministic workflow first, scoped memory second, retrieval where facts are missing, fine-tuning last**.

## Codebase Evidence
- `lib/jarvis/prompts.ts`: strict JSON output contracts and “never fabricate data” guidance.
- `lib/jarvis/context.ts`: recency windows and memory filtering by user/expiry.
- `lib/jarvis/memory.ts`: keyed upserts for durable behavioral facts.
- `AGENTIC_EXPANSION_V2.md:335`: explicit `code` vs `llm` blueprint split.
- `AGENTIC_EXPANSION_V2.md:418`: small-cap blueprint uses code for market/filing fetches and LLM only for analysis.

## Question Tree
1. **Is there a single correct answer, formula, rule, or route?**
   - Yes -> use **deterministic code**.
   - No -> continue.
2. **Does the model already have the needed facts in the request/context?**
   - No -> continue.
   - Yes -> likely **prompt/workflow/schema** problem.
3. **Are the missing facts user-specific or session/task-specific and small?**
   - Yes -> use **structured memory**.
   - No -> continue.
4. **Are the missing facts fresh, private, or buried in a larger corpus?**
   - Yes -> use **retrieval/RAG**.
   - No -> continue.
5. **Does the model know enough, but behave inconsistently across many examples?**
   - Yes -> try **better prompts/examples/evals** first, then **fine-tuning**.
   - No -> continue.
6. **Can the task be decomposed into fixed steps?**
   - Yes -> add a **deterministic workflow / blueprint**.
   - No -> use a more autonomous agent loop, but still keep tools, retrieval, and memory explicit.

## Comparison Table
| Problem type | Best lever | Why |
|---|---|---|
| Wrong format, tone, refusal policy, output shape | Prompt / instructions | This is behavior steering, not knowledge |
| Exact calculations, filters, route decisions, permissions | Deterministic code | Removes hallucination risk entirely |
| User preferences, active thesis state, prior decisions | Structured memory | Small durable context with identity/time scope |
| Current SEC filings, live prices, internal docs, large report archive | Retrieval / RAG | Injects missing facts and evidence |
| Repeated behavior failures despite good prompts and examples | Fine-tuning | Makes the behavior more consistently learned |
| Multi-step jobs with predictable stages | Deterministic workflow + selective LLM steps | Keeps judgment only where needed |

## Trading Research Agent Examples
1. **"Should this ticker be routed to Small Cap Trader or Long Term Investor?"**
   - Best lever: **deterministic code**.
   - Why: routing criteria are business rules, not model knowledge.

2. **"Summarize dilution risk from fresh S-3 and 8-K filings."**
   - Best lever: **retrieval/tool fetch + LLM analysis**.
   - Why: the facts are fresh and external; the reasoning is subjective but grounded.

3. **"Remember that I only want swing-trade setups with clear invalidation levels."**
   - Best lever: **structured memory**.
   - Why: small persistent preference, not a document retrieval problem.

4. **"Produce the research report in the exact JSON contract every time."**
   - Best lever: **prompt + schema + validator**, then **fine-tune** only if repeated failures remain.

5. **"Calculate VWAP, RSI, gap %, and float filters for scanner candidates."**
   - Best lever: **deterministic code**.
   - Why: these are exact computations from trusted inputs.

6. **"Generate consistent, high-signal trade thesis language across hundreds of reports."**
   - Best lever: start with **prompt/examples**, then **fine-tuning** if consistency still misses.

## Failure Diagnosis Heuristics
- **It cites fake facts or misses new information** -> retrieval gap, not prompt gap.
- **It ignores a known output contract** -> prompt/schema/validator gap, sometimes fine-tuning later.
- **It makes wrong calculations or routes** -> code gap; take the decision away from the model.
- **It remembers the wrong thing or too much irrelevant history** -> memory scoping/TTL problem.
- **It answers correctly when given the right evidence but poorly without it** -> retrieval/context problem.
- **It still behaves inconsistently even with good instructions and representative examples** -> fine-tuning candidate.
- **Quality drops after adding more context** -> you probably added noisy retrieval when the problem was behavior, not knowledge.
- **The agent feels "smart but flaky" across steps** -> workflow decomposition problem; add blueprint stages and validations.

## Recommended Default Escalation Order
1. **Start with evals and a failure taxonomy.** Label failures as behavior, knowledge, memory, retrieval, or workflow.
2. **Tighten prompts/instructions.** Add explicit task boundaries, examples, schemas, and “don’t know” behavior.
3. **Move exact logic into code.** Routing, filtering, calculations, permissions, and report assembly should be deterministic.
4. **Add blueprint/workflow structure.** Break the job into `fetch -> compute -> analyze -> assemble`.
5. **Add structured memory.** Store only durable user/task facts with scope and expiry.
6. **Add retrieval/RAG.** Only where the model lacks fresh/private/large-corpus facts.
7. **Tune retrieval separately from generation.** Filters, ranking, chunking, reranking, citations.
8. **Fine-tune last.** Do it when the remaining issue is repeated behavior consistency, not missing knowledge.

## Recommended Default Approach
For `AGENTIC_EXPANSION_V2.md`, default to this principle: **prompts define policy, code owns truth, memory stores durable small context, retrieval supplies missing evidence, and fine-tuning only hardens repeated behavior that survives all earlier fixes**.

In practical terms for Nexus Terminal: keep blueprints as the primary architecture, keep filing/market/trade data in deterministic fetch and calc steps, use memory for trader preferences and thesis state, and use retrieval/tool access for fresh filings and live market context. Only consider fine-tuning after you have a stable eval set showing the remaining failures are mostly stylistic or structural consistency failures.

## Action Checklist
- [ ] Define 20-50 evals across routing, research, macro, thesis update, and chat.
- [ ] Tag each eval failure by lever: prompt, code, memory, retrieval, workflow, fine-tuning.
- [ ] Keep all exact calculations and route decisions out of the model.
- [ ] Add memory TTL/scope rules before expanding memory volume.
- [ ] Add retrieval only for sources that are fresh, private, or too large for prompt context.
- [ ] Delay fine-tuning until prompt + workflow + retrieval are already stable.

## Known Unknowns
- Fine-tuning can help some reasoning-heavy tasks, but the strongest public guidance is still clearer on formatting/behavior consistency than on domain reasoning gains.
- Memory architecture remains less standardized than prompting or retrieval; production systems still vary widely in how much they vectorize vs key explicitly.

## Related Topics
- Agent eval design
- Context engineering
- Memory TTL and compaction
- Retrieval ranking and citations

## Follow-up Questions
- What should the eval taxonomy for `AGENTIC_EXPANSION_V2.md` look like?
- Which data in Nexus Terminal should be memory vs retrieval vs direct code access?
- When should the orchestrator route by rules vs by model judgment?

---
*To continue learning, ask a follow-up question about eval design, memory scope, retrieval boundaries, or fine-tuning thresholds.*
