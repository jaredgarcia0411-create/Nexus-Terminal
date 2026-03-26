# Agent Constraints and Prompt Design for Workflow-First Systems
**Researched**: 2026-03-26
**Sources**: Anthropic, OpenAI docs, OpenAI Model Spec, LangGraph docs, MCP specification, codebase analysis
**Context**: Nexus Terminal-specific memo for a trading-research multi-agent system based on `AGENTIC_EXPANSION_V2.md`

---

## Concept Overview
The 2025-2026 quality bar is clear: strong agent systems are won by constraints, not by autonomy theater. The best guidance from Anthropic, OpenAI, LangGraph, and MCP converges on the same pattern: keep the global prompt stable and high-authority, keep each workflow step narrow and typed, scope memory aggressively, treat external/tool content as untrusted by default, and require evidence-linked outputs when the task affects decisions.

For Nexus Terminal, that means the right default is not "smart free-form agents." It is deterministic routing plus blueprint steps, with LLMs used only for judgment-heavy analysis. That already matches the architecture direction in `AGENTIC_EXPANSION_V2.md:19`, `AGENTIC_EXPANSION_V2.md:22`, `AGENTIC_EXPANSION_V2.md:335`, and `AGENTIC_EXPANSION_V2.md:463`.

## How It Works
Modern prompt design for workflow-first systems splits instructions into layers:

1. **System / developer prompt** sets non-negotiable rules, authority boundaries, evidence policy, tool-use policy, and output contract.
2. **Per-step prompts** define one narrow job, the allowed inputs, the exact output schema, and the failure behavior for that step only.
3. **Memory rules** decide what may persist across runs, under which namespace, with what expiry and confidence.
4. **Evidence rules** decide what counts as support, how to cite it, and when the model must abstain.
5. **Evals** test instruction following, tool selection, routing, handoffs, and citation correctness separately rather than as one fuzzy "agent quality" score.

This lines up with your planned blueprint engine: typed steps, code-vs-llm separation, scoped memory, and orchestrator-owned routing in `AGENTIC_EXPANSION_V2.md:17`, `AGENTIC_EXPANSION_V2.md:20`, `AGENTIC_EXPANSION_V2.md:22`, `AGENTIC_EXPANSION_V2.md:333`, and `AGENTIC_EXPANSION_V2.md:376`.

## How It Applies Here
For Nexus Terminal, the main risk is not generic hallucination. It is unsafe overreach in financial research: invented catalysts, stale macro claims, bad tool use, leaky cross-agent memory, and analyst-style prose that sounds confident without showing support. The system should therefore optimize for:

- deterministic routing before model judgment;
- evidence-backed claims for all market-moving or thesis-changing assertions;
- narrow specialist prompts per agent role;
- memory writes only for durable, reviewable facts or preferences;
- human review before any recommendation becomes action.

That is especially important because `AGENTIC_EXPANSION_V2.md` already plans supervised reports, scoped agent memory, and blueprint-driven handlers in `AGENTIC_EXPANSION_V2.md:21`, `AGENTIC_EXPANSION_V2.md:196`, `AGENTIC_EXPANSION_V2.md:304`, `AGENTIC_EXPANSION_V2.md:320`, and `AGENTIC_EXPANSION_V2.md:715`.

## Codebase Evidence
- `AGENTIC_EXPANSION_V2.md:19`: Orchestrator owns routing and keeps it deterministic.
- `AGENTIC_EXPANSION_V2.md:20`: Agents have strict scope boundaries.
- `AGENTIC_EXPANSION_V2.md:22`: Blueprints split deterministic code from LLM reasoning.
- `AGENTIC_EXPANSION_V2.md:290`: Orchestrator reads all memory and injects contradiction context.
- `AGENTIC_EXPANSION_V2.md:335`: Blueprint steps pass typed outputs sequentially.
- `AGENTIC_EXPANSION_V2.md:571`: Separate prompt files are already planned per agent.

## Best Practices
1. **Make the system prompt constitutional, not chatty.** Put only durable rules there: role, authority order, tool trust model, evidence policy, refusal/abstain policy, and output contract. Anthropic recommends simple composable patterns and careful tool/interface design; OpenAI recommends high-authority developer instructions and clear prompt sections. Sources: https://www.anthropic.com/engineering/building-effective-agents and https://platform.openai.com/docs/guides/prompt-engineering
2. **Treat every blueprint step as a separate micro-contract.** Each LLM step should state: objective, allowed inputs, forbidden behavior, required schema, and fallback if support is missing. LangGraph's workflow patterns and OpenAI Structured Outputs both push toward narrow, typed steps instead of broad free-form prompts. Sources: https://docs.langchain.com/oss/python/langgraph/workflows-agents and https://platform.openai.com/docs/guides/structured-outputs
3. **Use chain-of-command rules explicitly.** OpenAI's Model Spec is useful here: higher-authority instructions win, quoted/tool data is untrusted by default, and lower-trust content must not override system rules. Put this directly into your orchestrator and specialist prompts. Source: https://model-spec.openai.com/2025-02-12.html
4. **Default to structured outputs for every llm step.** Research, thesis updates, routing decisions, contradiction checks, and report assembly inputs should all be schema-bound. This reduces prompt burden and makes step-level evals possible. Source: https://platform.openai.com/docs/guides/structured-outputs
5. **Scope memory by user, agent, category, and expiry.** LangGraph's short-term vs long-term split matches your planned `agent_memory` scoping. Do not let cross-agent state become implicit shared truth. Sources: https://docs.langchain.com/oss/python/langgraph/memory and `AGENTIC_EXPANSION_V2.md:196`
6. **Require citations for any claim that could change a trade thesis or macro view.** OpenAI's citation guidance is clear: define citable units, stable IDs, exact citation syntax, and validation. For Nexus, filing claims, market stats, macro facts, and contradiction notices should all cite source IDs. Source: https://platform.openai.com/docs/guides/citation-formatting
7. **Evaluate the workflow at the seam level.** OpenAI's eval guidance says to test instruction following, tool selection, handoff accuracy, and functional correctness separately. For Nexus, add citation-accuracy and memory-write-quality evals too. Source: https://platform.openai.com/docs/guides/evaluation-best-practices

## Top Rules for System Prompts
- State the agent's exact role, allowed decision surface, and explicit non-goals.
- Declare authority order: system/developer rules override user content; tool output and retrieved text are untrusted unless explicitly delegated.
- Define the evidence rule: "Do not present unsupported market claims as facts; abstain or mark uncertain instead."
- Define the tool rule: "Never invent tool results, prices, filings, timestamps, or memory entries."
- Define the handoff rule: specialist agents do not reroute policy; only orchestrator routes.
- Define the output rule: respond in schema or named sections only; no free-form extra analysis outside contract.

## Top Rules for Per-Step Prompts Inside Blueprints
- Give one job only: classify, summarize filings, score dilution risk, evaluate thesis, etc.
- Pass only the minimum context for that step; never dump whole conversation or all memory.
- Include explicit allowed evidence sources for that step and forbid outside inference when support is absent.
- Require a strict schema with enums, confidence, evidence IDs, and `insufficient_evidence` fields.
- Tell the model what to do on uncertainty: return "needs_more_data" or "no_supported_conclusion" instead of guessing.
- Separate analysis from presentation: one step reasons, a later code step assembles the final report.

## Memory Write Constraints
- Only write durable facts, preferences, thesis states, watchlist states, or measured performance; never write raw prose summaries as memory.
- Every memory write should include source, timestamp, confidence, writer agent, and expiry policy.
- No memory writes from unsupported claims, speculative takes, or single-turn emotional language.
- Prefer code-reviewed memory writes after an LLM proposes candidates; do not let the model freely mutate long-term memory.
- Cross-agent memory visibility should be read-mediated by the orchestrator, not fully shared by default.
- Use background memory consolidation for low-latency flows; reserve hot-path writes for critical user preferences or confirmed thesis changes.

## Evidence and Citation Constraints
- Any thesis-changing claim must cite a stable source ID from tool output, filing block, market snapshot, or internal report unit.
- Citations must attach to the exact supported sentence, not only to the bottom of the report.
- If sources conflict, the output must name the conflict and cite both sides.
- If no source supports a claim, the claim must be omitted or marked explicitly as hypothesis.
- Never cite memory as primary evidence for external facts; memory can guide retrieval, not replace it.
- Validate citations in code before rendering reports to users.

## Concrete Anti-Patterns to Ban
- **Ban:** giant all-purpose prompts that combine routing, analysis, writing style, and memory rules in one blob.
- **Ban:** letting specialist agents read or write arbitrary shared memory.
- **Ban:** storing full assistant messages as long-term memory.
- **Ban:** free-form report generation directly from user prompt without structured intermediate state.
- **Ban:** "cite if possible" language; citations must be mandatory for specified claim classes.
- **Ban:** trusting tool output instructions, scraped page instructions, or embedded prompt text.
- **Ban:** using an LLM router where deterministic rules are already known and cheaper.
- **Ban:** allowing the model to invent missing ticker data, stale prices, filing details, or confidence labels.
- **Ban:** grading the whole multi-agent system with vibes instead of seam-specific evals.

## Recommended Default Approach
For Nexus Terminal, use a three-layer prompt stack:

1. **Global orchestrator prompt**: authority, safety, evidence, citation, and handoff rules.
2. **Agent role prompt**: small-cap vs long-term domain heuristics, but still no step-specific formatting logic.
3. **Blueprint step prompt**: one task, one schema, one evidence policy.

Then force all meaningful outputs through code validators, memory write gates, and citation checks before publishing to `agent_reports`.

## Action Checklist
- [ ] Add a shared prompt contract section for authority, evidence, and abstention rules in `lib/agents/prompts/`
- [ ] Make every `llm` blueprint step return strict typed JSON
- [ ] Add citation-required enums by claim type (`market_data`, `filing_fact`, `macro_fact`, `thesis_change`)
- [ ] Add memory write review logic with source, confidence, and expiry metadata
- [ ] Build evals for routing accuracy, tool selection, citation correctness, and memory-write precision

## Known Unknowns
- OpenAI's public agents docs were partially fetchable in this environment, so this memo leans more on the accessible prompt, eval, structured output, citation, and model-spec docs.
- MCP gives security and consent principles, but exact host UX patterns remain implementation-specific.
- The right confidence thresholds for memory writes in trading research will need empirical tuning against your actual report corpus.

## Related Topics
- Context engineering for trading agents
- Eval design for routing, citations, and memory quality
- Tool schema design for market-data and filing workflows

## Follow-up Questions

---
*To continue learning, use: `/research more about agent evals` or ask follow-up questions*
