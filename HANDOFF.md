# Nexus Terminal — HANDOFF.md

> Older completed execution specs were removed to keep this file focused. Use git history for archived implementation detail.

### Workflow Tooling Note

- 2026-04-06: Added a repo-maintained Codex `commit` alias skill in [`codex-skills/commit/`](/home/jared/Nexus-Terminal/codex-skills/commit) and UI metadata for [`codex-skills/nexus-commit/`](/home/jared/Nexus-Terminal/codex-skills/nexus-commit) so Codex can surface a user-facing commit entry point while keeping `nexus-commit` as the canonical workflow.
- 2026-04-07: Audited the Codex harness docs and refreshed [`AGENTS.md`](/home/jared/Nexus-Terminal/AGENTS.md) plus repo-maintained skill sources in [`codex-skills/`](/home/jared/Nexus-Terminal/codex-skills) to remove stale `.claude`/`.opencode` assumptions, fix the `lib/trade-utils.ts` path, and document repo-local skill agent metadata.
- 2026-04-12: Added a repo-maintained Codex deep-research skill in [`codex-skills/nexus-deep-research/`](/home/jared/Nexus-Terminal/codex-skills/nexus-deep-research). It coordinates parallel subagent research passes for repo-specific investigations and only saves markdown briefs under `docs/research/` when the user explicitly asks for an artifact.
- 2026-04-12: Clarified skill discovery in [`AGENTS.md`](/home/jared/Nexus-Terminal/AGENTS.md): repo-local `codex-skills/` content is source-of-truth for the repo, but Codex only surfaces a skill after it is synced into `~/.codex/skills/<skill-name>` and the session is restarted.
- 2026-04-12: Archived the completed AEV2 execution plan; `HANDOFF.md` is again the active execution-spec surface and git history is the archive for completed rollout sequencing.

---

## Agent Response Improvement — Reports + Macro Summary (P2+)

> Generated: 2026-04-12
> Revised: 2026-04-12
> Status: COMPLETE — Steps 1-6 complete

### Checkpoint — 2026-04-12

- Completed: Step 1 — typed report contracts and report/macro route metadata.
- Completed: Step 2 — assistant-turn persistence, routed specialist metadata, Discord specialist wait/reply flow.
- Completed: Step 3 — small-cap TradingView expansion, explicit AskEdgar sections, deterministic analysis step.
- Completed: Step 4 — swing enrichment, deterministic technicals, runner-quality inputs, thesis memory writes.
- Completed: Step 5 — typed Discord report renderers for small-cap, swing, and macro reports.
- Completed: Step 6 — macro summary redesign, compact orchestrator macro context, legacy-shape runtime guard.
- Validation at this checkpoint:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm test`

### Compact Summary

- `agent_reports.report_json` is now the canonical typed research object. Shared contracts for small-cap, swing, macro, and the report API envelope live in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts).
- The orchestrator now persists assistant turns, routes specialist metadata cleanly, returns specialist completion metadata to the service chat route, and formats macro context compactly instead of passing raw JSON into synthesis prompts.
- Small-cap and swing research blueprints now pass deterministic, source-backed inputs into the LLM. Swing additionally writes `thesis` memory keyed by ticker with a 7-day TTL.
- Discord delivery now renders small-cap, swing, and macro reports from typed payloads rather than fallback key guessing.
- Macro summary storage, context loading, Discord rendering, and API output now share one `MacroSummaryReport` shape, with deterministic `crossAssetSnapshot` and `sourceIndex` assembled before the LLM step.

### Implementation Surface

- Contracts and routes:
  [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts),
  [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts),
  [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts),
  [`app/api/agents/macro-summary/latest/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/macro-summary/latest/route.ts),
  [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts).
- Orchestrator and macro flow:
  [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts),
  [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts),
  [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts),
  [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts),
  [`lib/agents/prompts/orchestrator.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/orchestrator.md).
- Specialist research and delivery:
  [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts),
  [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts),
  [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts),
  [`lib/agents/prompts/small-cap.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/small-cap.md),
  [`lib/agents/prompts/swing-trader.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/swing-trader.md).
- Test coverage:
  [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts),
  [`__tests__/agent-discord.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-discord.test.ts),
  [`__tests__/agent-service-chat-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-service-chat-route.test.ts),
  [`__tests__/agent-context.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts),
  [`__tests__/agent-macro-summary-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-macro-summary-route.test.ts),
  [`__tests__/agent-reports-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-reports-route.test.ts).

### Guardrails Retained

- No schema or migration changes were introduced.
- All data fetching remains server-side; no provider credentials or raw premium payloads are exposed.
- Swing output remains traffic-light plus pattern context only. No entry, stop, or target levels were reintroduced.
- `evidenceIds: string[]` stays in place. Attribution/provenance redesign remains deferred.
- `pre-market-scan`, `momentum-scan`, and `pattern-check` remain stubs and were not expanded by this spec.

### Validation

- Required repo validation rerun after completion:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm test`
- Latest full suite result at completion: 45 test files passed, 316 tests passed.

### Deferred Follow-Up

- Replace `evidenceIds` with section-level provenance or a shared report-level source index for specialist reports.
- Add richer source metadata to catalyst-heavy sections once the current report contracts are stable.
- Treat social/X inputs as attention signals only unless corroborated by durable sources.
- If follow-on agent work starts from here, write a new execution spec instead of extending this completed rollout.
