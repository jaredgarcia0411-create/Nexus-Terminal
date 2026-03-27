# Cost-Predictable Multi-Agent LLM Systems Crash Course
**Researched**: 2026-03-26
**Sources**: OpenAI docs, Anthropic docs/engineering, OpenRouter docs, LangSmith docs, LlamaIndex docs, llama.cpp docs, codebase analysis
**Context**: Codebase-specific research for Nexus Terminal's planned orchestrator + specialist agent architecture

---

## Concept Overview
Cost-predictable multi-agent systems work best when most steps stay deterministic and only narrow, high-value steps call an LLM. The consistent advice across OpenAI, Anthropic, LangSmith, LlamaIndex, OpenRouter, and llama.cpp is the same: route simple work to cheaper models, use schemas and validators to prevent retry waste, isolate spend by project/key, instrument every model hop, and put hard stops around retries and async workloads.

## How It Works
The main cost levers are straightforward: reduce the number of LLM calls, reduce tokens per call, use cheaper models for narrow subtasks, and make expensive models opt-in rather than default. Predictability comes from turning fuzzy agent loops into typed workflows: deterministic code for routing/filtering/calculation, schema-bound LLM calls for judgment/synthesis, observability on every hop, and budget controls that fail closed instead of silently overspending.

## How It Applies Here
For Nexus, the strongest default is already visible in your architecture direction: keep routing deterministic, keep blueprint steps typed, and reserve LLMs for synthesis/judgment only. Your current Jarvis client is single-provider and retries once in-process; the next step is not “more agents first,” but better routing and spend isolation: separate projects/keys by environment and agent role, add per-step usage logging, and make each blueprint step choose among `local -> cheap remote -> expensive remote` based on task class and confidence.

## Codebase Evidence
- `lib/jarvis/client.ts`: current LLM wrapper is provider-agnostic via base URL, already has timeout + retry + circuit breaker, but no per-step cost routing or schema enforcement.
- `README.md:44`: current production note already emphasizes Groq free-tier availability and a configurable model, which makes model-tier routing practical.
- `AGENTIC_EXPANSION_V2.md:19`: orchestrator routing is intentionally deterministic, which is exactly the right place to avoid unnecessary LLM spend.
- `AGENTIC_EXPANSION_V2.md:22`: blueprint steps already separate `code` vs `llm`, which is the strongest cost-control primitive in the whole design.

## Code Examples

### Basic Usage
```ts
type TaskClass = 'route' | 'extract' | 'judge' | 'final_answer'

function pickTier(task: TaskClass, canRunLocal: boolean) {
  if (task === 'route') return { mode: 'code' }
  if (task === 'extract' && canRunLocal) return { mode: 'local-small' }
  if (task === 'extract') return { mode: 'remote-cheap' }
  if (task === 'judge') return { mode: 'remote-cheap' }
  return { mode: 'remote-expensive' }
}
```

### In Your Codebase
From: `lib/jarvis/client.ts`
```ts
export async function callJarvis(systemPrompt: string, userMessage: string, temperature = 0.2) {
  if (isCircuitOpen()) {
    throw new Error('Jarvis circuit breaker is open')
  }

  try {
    const result = await requestLlm(systemPrompt, userMessage, temperature)
    recordLlmSuccess()
    return result
  } catch (firstError) {
    recordLlmFailure()
    if (isCircuitOpen()) {
      throw firstError
    }
    // one retry today; good base for adding retry budgets per step
  }
}
```

## Best Practices
1. Use deterministic routing first. Anthropic explicitly recommends starting with workflows over agents, and your `AGENTIC_EXPANSION_V2.md` already follows that pattern. Source: https://www.anthropic.com/engineering/building-effective-agents
2. Route by task class, not by agent name. Send extraction/classification/guardrails to small or local models; reserve expensive models for final synthesis, ambiguous reasoning, or judge/evaluator roles. Sources: https://www.anthropic.com/engineering/building-effective-agents and https://docs.llamaindex.ai/en/stable/module_guides/querying/router/
3. Treat free models as dev/test tools or overflow capacity, not production defaults. OpenRouter is explicit that free models have low rate limits and are usually not suitable for production use. Source: https://openrouter.ai/docs/faq
4. Separate projects, keys, and spend limits by environment and blast radius. OpenAI recommends separate staging/production projects and supports custom rate/spend limits per project; RBAC also lets you isolate keys and permissions. Sources: https://platform.openai.com/docs/guides/production-best-practices and https://platform.openai.com/docs/guides/rbac
5. Log every LLM hop with model, tokens, latency, cache hits, retries, and outcome. LangSmith and LlamaIndex both frame observability as mandatory, not optional, because LLM systems are nondeterministic. Sources: https://docs.langchain.com/langsmith/observability-quickstart and https://docs.llamaindex.ai/en/stable/module_guides/observability/
6. Put hard budget controls in code, not just dashboards. Use per-request max token caps, per-step retry caps, per-job budget ceilings, and per-project spend limits; fail closed when exceeded. Sources: https://platform.openai.com/docs/guides/rate-limits and https://platform.openai.com/docs/guides/production-best-practices
7. Use structured outputs everywhere an agent hands work to code. OpenAI and LlamaIndex both stress schemas because they reduce parse failures and retry churn. Sources: https://platform.openai.com/docs/guides/structured-outputs and https://docs.llamaindex.ai/en/stable/module_guides/querying/structured_outputs/
8. Keep prompts cache-friendly. Put stable instructions/tools/examples first and dynamic content last; monitor cache hit rates. OpenAI and Anthropic both document exact-prefix caching behavior. Sources: https://platform.openai.com/docs/guides/prompt-caching and https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
9. Batch and defer non-urgent work. OpenAI Batch gives 50% lower cost, and Flex processing is explicitly for lower-priority async workloads. Sources: https://platform.openai.com/docs/guides/batch and https://platform.openai.com/docs/guides/flex-processing
10. Offload narrow deterministic-ish work to local models when privacy/cost matters more than frontier quality. llama.cpp exposes an OpenAI-compatible local server, quantization, and CPU/GPU hybrid inference, making it viable for extraction, classification, and draft generation. Source: https://github.com/ggml-org/llama.cpp/blob/master/README.md

## Common Pitfalls
**Pitfall**: Letting every agent call the best model by default.
**Solution**: Make the expensive model an escalation path only after cheap/local attempts fail confidence checks or schema validation. Sources: https://www.anthropic.com/engineering/building-effective-agents and https://platform.openai.com/docs/guides/cost-optimization

**Pitfall**: Free-model optimism in production.
**Solution**: Use free models for evals, smoke tests, playgrounds, and non-critical background drafts only. OpenRouter warns they have low rate limits and are usually not production-suitable. Source: https://openrouter.ai/docs/faq

**Pitfall**: Using retries as a quality strategy.
**Solution**: Retry only transient failures (429/408/network); for invalid outputs use one repair pass with the same schema, then escalate or fail. Rate-limit docs also warn failed requests still count against limits. Source: https://platform.openai.com/docs/guides/rate-limits

**Pitfall**: Measuring only final-answer quality.
**Solution**: Evaluate routing accuracy, tool selection, handoff accuracy, schema validity, and final quality separately. Source: https://platform.openai.com/docs/guides/evaluation-best-practices

**Pitfall**: Huge unstructured prompts on every turn.
**Solution**: Use caching, context pruning, and deterministic retrieval/assembly; don't pay frontier-model prices to repeatedly restate static instructions. Sources: https://platform.openai.com/docs/guides/prompt-caching and https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

## Recommended Default Approach
Use a three-tier routing ladder: deterministic code first, then local/small model, then cheap remote model, and only then an expensive frontier model. For Nexus specifically: keep the orchestrator fully deterministic for routing and job decomposition; use local or cheap remote models for extraction/classification/checks; use the expensive model only for final synthesis, ambiguous market reasoning, or evaluator/judge passes where errors are materially costly.

## Action Checklist
- [ ] Add per-step metadata to the LLM wrapper: `taskClass`, `budgetCents`, `maxOutputTokens`, `retryPolicy`, `schemaName`
- [ ] Split API keys/projects by `dev`, `staging`, `prod`, plus at least one separate project for offline eval/batch workloads
- [ ] Log model, prompt tokens, completion tokens, latency, retries, and cache stats for every LLM step
- [ ] Enforce Zod/Pydantic-style structured outputs for all non-user-facing agent handoffs
- [ ] Add job-level budget accounting so a single agent task cannot loop through unlimited retries or escalations
- [ ] Add a local-model lane for extraction/classification/drafting via llama.cpp or equivalent OpenAI-compatible local server

## Recommended Routing Policy For A 3-Agent System
1. **Orchestrator**: no LLM for normal routing, decomposition, thresholds, freshness checks, or queue decisions. Use deterministic code and rules only. If the orchestrator must summarize cross-agent results for a human, use a cheap remote model first and escalate only if the answer is low-confidence or rejected by validators.
2. **Specialist agents, deterministic steps**: never call an LLM for parsing market data, filtering candidates, computing indicators, joining SQL data, validating freshness, or shaping API payloads. These stay in code.
3. **Specialist agents, narrow LLM steps**: use a local or cheapest reliable model for extraction, tagging, contradiction checks, simple classification, and first-pass draft writing. Require strict schema output.
4. **Escalation trigger**: escalate to an expensive model only when one of these is true: schema repair failed once, confidence is below threshold, multiple sources conflict, the output is user-visible and high-stakes, or an evaluator step flags the cheap answer as insufficient.
5. **Retries/repair loop**: transient failure -> exponential backoff retry; schema failure -> one repair call with the same model and explicit validation errors; persistent failure -> escalate once; after that, return a typed partial/failure result instead of looping.
6. **Batching/offline**: evaluations, backfills, nightly summarization, clustering, and enrichment jobs go to Batch/Flex or equivalent async tier. Never let background work contend with interactive budgets.
7. **Free models**: allow only for playgrounds, smoke tests, non-blocking drafts, and fallback experiments behind feature flags; never for SLA-backed interactive flows.

## Known Unknowns
- OpenRouter's provider-routing page was not directly fetchable in this environment, so OpenRouter routing guidance here leans on the FAQ plus general routing patterns from Anthropic/LlamaIndex.
- Provider-specific structured output guarantees differ in practice; you should verify exact schema adherence on your chosen cheap/local models before relying on them for repairs or handoffs.
- Local-model economics depend heavily on your hardware and concurrency profile; llama.cpp makes local serving practical, but whether it is actually cheaper than hosted small models depends on utilization.

## Related Topics
- Evals for routing and handoff accuracy
- Local model serving with llama.cpp
- Structured outputs and validator-driven repair loops

## Follow-up Questions

---
*To continue learning, use: `/research more about cost-predictable multi-agent LLM systems` or ask follow-up questions*
