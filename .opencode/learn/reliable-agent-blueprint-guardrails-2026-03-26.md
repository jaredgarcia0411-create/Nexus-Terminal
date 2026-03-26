# Reliable Agent Blueprint Guardrails Crash Course
**Researched**: 2026-03-26
**Sources**: LangGraph docs, Azure Architecture Center, OpenAI docs, Anthropic engineering guidance, codebase analysis
**Context**: Tailored to Nexus Terminal's sequential blueprint system in `AGENTIC_EXPANSION_V2.md`

---

## Concept Overview
Reliable agent execution comes from treating each workflow step like a typed service boundary, not like a free-form chat turn. The modern consensus across production guidance is: keep routing and validation deterministic where possible, make LLM outputs schema-bound, and only let later steps run when earlier steps have passed explicit checks.

## How It Works
For sequential workflow systems, every step should have a contract: declared inputs, declared outputs, validation rules, timeout budget, retry policy, and an escalation path. Code steps should do retrieval, normalization, filtering, thresholding, joins, persistence, and safety checks. LLM steps should do the narrower jobs that actually need judgment: synthesis, tradeoff explanation, ranking under ambiguity, and narrative generation.

## How It Applies Here
Your blueprint design in `AGENTIC_EXPANSION_V2.md` is already pointed in the right direction because it separates `code` from `llm` steps and runs steps sequentially. The missing guardrails are mostly around contract enforcement: stronger typed `StepInput`/`StepOutput`, schema validation between every hop, step-level status logging, explicit retry classes, and deterministic "stop the line" checks before any LLM output can influence persistence, routing, or alerts.

## Codebase Evidence
- `AGENTIC_EXPANSION_V2.md`: Defines the blueprint runner, step types, retry loop, job queue, and observability shape.
- `HANDOFF.md`: Shows this repo already values exact step ordering, explicit validation, and fail-fast fixes before proceeding.

## Memo

### 1) Required invariants for step inputs and outputs

1. Every step must declare a versioned schema for input and output; `unknown` is fine at the transport boundary, but not inside the runner.
2. Every output must include: `status`, `data`, `artifacts`, `metrics`, and `provenance`.
3. `data` should contain only the normalized payload needed by the next step; raw tool responses belong in `artifacts` for audit/debug.
4. `provenance` should record source IDs, timestamps, tickers, query params, model name, prompt version, and upstream step IDs.
5. LLM outputs must be structured outputs with strict schema validation; never accept free-text JSON-like blobs.
6. Step outputs must be immutable snapshots; downstream steps may derive new fields but must not mutate prior step records.
7. Each step must declare whether it is pure, idempotent, or side-effecting; retries are only automatic for idempotent steps.
8. Each step must carry a confidence field only when confidence is meaningful; do not invent confidence for deterministic code.

### 2) Validation rules between steps

1. Validate schema first, then business rules second.
2. Use deterministic gates between steps: non-empty candidate sets, ticker format validity, filing freshness windows, numeric ranges, required source counts, and dedupe checks.
3. Reject stale or partial market data before any analysis step; code should decide "insufficient data," not the LLM.
4. For LLM outputs, validate enums, required keys, max lengths, evidence count, and citation/source linkage.
5. Require step-specific acceptance checks, e.g. `analyze-dilution` cannot emit a risk score without linked filing evidence; `generate-theses` cannot emit a thesis without invalidation criteria.
6. On validation failure, stop the blueprint or route to a repair step; never silently pass malformed outputs downstream.

### 3) Retry and escalation rules

1. Split failures into `transient`, `input-quality`, `contract`, `dependency`, and `policy` classes.
2. Retry only transient/dependency failures automatically: timeouts, rate limits, temporary API/network faults, DB lock contention.
3. Do not retry contract failures unchanged; repair the payload or fail fast.
4. For LLM steps, allow at most one repair retry with the validation errors fed back in structured form; after that escalate.
5. Side-effecting steps must use idempotency keys so a retry cannot double-write reports, memory entries, or jobs.
6. Escalate to orchestrator/human review when: max attempts reached, two consecutive contract failures, contradictory cross-agent conclusions, budget threshold exceeded, or a degraded dependency would materially lower quality.
7. Preserve the last good step output and resume from the failed step when possible instead of replaying the whole blueprint.

### 4) Observability and progress requirements

1. Persist a step execution ledger, not just job status: `queued`, `running`, `validated`, `retrying`, `failed`, `escalated`, `completed`.
2. Log per step: start/end time, duration, attempt, validator result, input/output schema version, token usage, model used, dependency calls, and error class.
3. Record user-visible progress states based on step names, e.g. "fetching filings," "analyzing dilution," "assembling report."
4. Keep raw artifacts for debugging, but present compact summaries in UI/admin stats.
5. Trace parent job -> sub-job -> step lineage so split-routing and aggregation are auditable.
6. Add SLA alerts for stuck jobs, repeated repair loops, missing heartbeats, and rising validation-failure rates.

### 5) Where deterministic checks should replace LLM judgment

Use code for:

- Routing rules, threshold checks, ticker normalization, dedupe, sorting, filtering, freshness checks, missing-field detection, and report status transitions.
- Data extraction when the source is structured enough to parse deterministically.
- Eligibility decisions like "does this candidate meet pre-market scan thresholds?"
- Conflict detection when it can be expressed as explicit rules.
- Any safety, auth, budget, or permission gate.

Use LLMs for:

- Synthesizing a thesis from already-validated evidence.
- Explaining why two valid signals conflict.
- Ranking plausible interpretations when code cannot define the heuristic cleanly.
- Writing user-facing summaries from structured inputs.

### 6) Recommendations specific to `AGENTIC_EXPANSION_V2.md`

1. Replace `StepInput.previousOutput: unknown` and `StepOutput.data: unknown` with blueprint-specific Zod schemas or typed generics. The current shape is too loose for reliable chaining.
2. Extend `runBlueprint()` so every step runs `validateInput(step)` before execution and `validateOutput(step)` after execution.
3. Add a `StepResult` envelope: `{ status, data, artifacts, metrics, provenance, validator }` instead of only `{ data, tokensUsed? }`.
4. Add `canRetry`, `timeoutMs`, `maxRepairAttempts`, `sideEffect`, and `idempotencyKey` metadata to each blueprint step.
5. Save per-step rows in a new `agent_job_steps` table or equivalent JSONB execution log on `agent_jobs`; current job-level status is too coarse for debugging and UI progress.
6. Move "assemble-report" and "update-memory" behind deterministic final validators so malformed LLM output cannot be persisted.
7. For orchestrator split jobs, require a deterministic aggregation contract: expected sub-job count, timeout window, partial-result policy, and contradiction policy.
8. Enforce structured outputs in `lib/agents/llm-client.ts`; the wrapper should accept a schema and return parsed data only.
9. Add checkpoint/resume semantics to the blueprint runner so retries resume from the failed step, matching Azure/LangGraph guidance on persistence and recovery.
10. Upgrade observability from token accounting to execution accounting: validation pass rate, retry rate by step, stale-data rejection rate, and median duration per blueprint step.

## Best Practices
1. Prefer the simplest pattern that works; sequential blueprints are a better default than open-ended agents for this architecture.
2. Make every LLM boundary typed and validated.
3. Treat retries as a policy decision per step, not a generic job-level behavior.
4. Keep raw evidence outside the model and pass only the minimal normalized subset needed.
5. Design for resume-from-checkpoint, not replay-from-start.

## Common Pitfalls
**Pitfall**: Passing loosely typed blobs between steps.
**Solution**: Use versioned schemas and post-step validators.

**Pitfall**: Letting LLMs decide routing, thresholds, or persistence readiness.
**Solution**: Move those checks into deterministic code.

**Pitfall**: Logging only final job status.
**Solution**: Persist a step ledger with attempts, validators, and artifacts.

## Recommended Default Approach
For Nexus Terminal, keep the sequential blueprint architecture but harden it into a contract-enforced pipeline: typed step schemas, deterministic validators between all steps, one repair retry for LLM contract failures, checkpointed resume, and step-level observability. That gives you most of the reliability benefit of heavier workflow frameworks without giving up your simple Postgres-backed design.

## Action Checklist
- [ ] Add typed schemas and validator hooks to `lib/agents/blueprint-runner.ts` once implemented.
- [ ] Add per-step execution persistence (`agent_job_steps` or JSONB ledger).
- [ ] Update `lib/agents/llm-client.ts` to require structured output schemas.
- [ ] Define blueprint-specific deterministic acceptance rules before writing reports/memory.

## Known Unknowns
- The blueprint references a Stripe-inspired engine, but this repo does not yet include the actual implementation details, so recommendations are aimed at the architecture spec rather than existing code.
- Exact validator thresholds for trading quality should come from product-specific acceptance criteria, not generic agent guidance.

## Related Topics
- Step-level idempotency and checkpointing
- LLM structured outputs with Zod
- Workflow evals for multi-step systems

## Sources
- LangGraph, "Workflows and agents": https://docs.langchain.com/oss/python/langgraph/workflows-agents
- Microsoft Azure Architecture Center, "AI Agent Orchestration Patterns": https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns
- OpenAI Docs, "Structured model outputs": https://platform.openai.com/docs/guides/structured-outputs
- OpenAI Docs, "Evaluation best practices": https://platform.openai.com/docs/guides/evaluation-best-practices
- Anthropic Engineering, "Building effective agents": https://www.anthropic.com/engineering/building-effective-agents

## Follow-up Questions

---
*To continue learning, use: `/research more about reliable agent blueprints` or ask follow-up questions*
