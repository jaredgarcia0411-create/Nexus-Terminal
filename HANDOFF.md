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
> Status: READY FOR EXECUTION

### Objective

Finish the remaining response-quality work after the completed P0/P1 pass: persist assistant turns, route routed specialist results back into Discord, enrich the specialist report objects so they are deterministic and source-backed, rebuild the report renderers around stable contracts, and redesign the macro summary so the stored JSON, Discord embed, context assembly, and API route all agree.

### Locked Decisions

- Discord remains the primary delivery surface, but `agent_reports.report_json` becomes the canonical typed research object.
- Source-backed JSON comes first; routes should expose the stored contract rather than invent UI-only fields.
- `market-strength` and `ai-chart-analysis` are optional enrichments. Use them only if their endpoint contracts are verified during implementation.
- `fetchJmt415()` is out of scope for this sprint unless its endpoint contract is confirmed before coding begins.
- No entry, stop, or target levels return to the swing report. Keep it traffic-light plus pattern context only.

### Current State

- [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts) persists the user turn into `agent_conversations`, but [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts) does not persist the assistant reply after synthesis.
- [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts) stops at "Your request was routed..." when the orchestrator hands work to a specialist. It never posts the final specialist result back into `#orchestrator`.
- [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts) and [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts) now emit traffic-light JSON, but they still underuse the AskEdgar snapshot and only send thin deterministic inputs into the LLM.
- [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) renders small-cap and swing research from semi-structured payloads, but `buildMacroSummaryEmbed()` still expects a shape that [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts) does not store.
- [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts) stores `{ tradingDate, summary, keyEvents, sectorNotes, confidence }`, while [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts), [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts), and [`app/api/agents/macro-summary/latest/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/macro-summary/latest/route.ts) all treat macro data as an untyped blob.
- [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts) and [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts) currently expose only the minimum fields. They do not surface summary and delivery metadata consistently enough for future report consumers.
- [`lib/agents/config.ts`](/home/jared/Nexus-Terminal/lib/agents/config.ts) still leaves `pre-market-scan`, `momentum-scan`, and `pattern-check` as stubs. This spec does not implement those blueprints.

### Scope Boundaries

- Do not add new tables or migrations.
- Do not change auth, queue semantics, or webhook idempotency beyond what is required for routed specialist replies.
- Do not add unverified premium AskEdgar endpoints as hard dependencies.
- Keep all data-fetching server-side. Do not expose API keys or raw provider payloads to the client.

### Required Changes

#### Step 1 — Lock Typed Report Contracts And Route Metadata

- **Files:** [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts), [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts), [`app/api/agents/macro-summary/latest/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/macro-summary/latest/route.ts)
- **Actions:**
  - Define explicit TypeScript interfaces for the stored small-cap research report, swing research report, and macro summary report.
  - Replace `AgentContext.macroSummary: unknown | null` usage points with the new macro type where practical.
  - Keep `agent_reports.report_json` as JSONB, but make the route layer return stable metadata alongside the raw JSON: `title`, `summary`, `status`, `delivery_error`, `created_at`, and the typed `report_json` payload where available.
  - Change the macro latest route to return the latest stored macro report plus delivery state instead of hiding failed deliveries behind a published-only filter.
- **Why order matters:** every downstream blueprint, embed builder, and test needs a single contract to target.
- **Acceptance criteria:**
  - Explicit interfaces exist for all three report families.
  - Routes no longer rely on anonymous `unknown` payloads at their contract boundaries.
  - The macro latest route exposes delivery status.

#### Step 2 — Persist Assistant Turns And Routed Reply Context

- **Files:** [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts), [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts), [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts)
- **Tests:** [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts), [`__tests__/agent-service-chat-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-service-chat-route.test.ts)
- **Actions:**
  - After the orchestrator synthesis step completes, insert a matching `role: 'assistant'` row into `agent_conversations` using the existing `session_id` and channel.
  - When the orchestrator routes to a specialist, preserve enough origin context on the specialist job input or result path for the Discord bot to correlate the final output back to the originating Discord message and channel without adding a new table.
  - Extend the Discord bot flow so a routed request polls the specialist job or report path and posts the final specialist summary back into `#orchestrator` instead of stopping at the job ID.
  - Preserve current auth boundaries: the Discord bot continues using service-authenticated routes only.
- **Why order matters:** conversation history and routed reply handling both depend on stable session and origin metadata before report rendering changes land.
- **Acceptance criteria:**
  - Assistant turns are stored for orchestrator chat sessions.
  - Routed specialist requests produce a final Discord reply.
  - Repeated polls do not create duplicate Discord posts.

#### Step 3 — Enrich Small-Cap Inputs Before The LLM

- **Files:** [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts), [`lib/agents/prompts/small-cap.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/small-cap.md), [`lib/agents/prompts/jmt-report-format.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/jmt-report-format.md)
- **Optional only if contract is verified first:** [`lib/askedgar.ts`](/home/jared/Nexus-Terminal/lib/askedgar.ts)
- **Actions:**
  - Expand the TradingView scanner columns to include `High.1W`, `Low.1W`, `RSI`, `MACD.macd`, `EMA9`, and `EMA21`.
  - Promote existing AskEdgar sections into explicit deterministic inputs: `gapStats`, `news`, `dilution-rating`, `dilution-data`, `offerings`, `registrations`, `equity-lines`, `ownership`, `historical-float-pro`, `reverse-splits`, `split-status`, `agreements`, `nasdaq-compliance`, and `pump-and-dump-tracker`.
  - Compute deterministic pre-LLM fields before prompt assembly: `gapCount`, `sameDayFadeRate`, `avgCloseVsOpen`, `avgHighExtension`, `avgPremarketToVWAPFade`, `offeringTagFrequencyOnGapDays`, `hasActiveShelf`, `hasActiveAtm`, `amountRemainingAtm`, `splitApproved`, `splitEffectivePending`, `daysToComplianceDeadline`, `floatTrend`, and `knownHolderOverhang`.
  - Keep the LLM responsible for judgment and narrative only. Do not ask it to infer simple numeric rollups from raw blobs.
  - Keep `market-strength` optional unless the endpoint contract is verified during implementation.
- **Acceptance criteria:**
  - The prompt input object contains deterministic chart-history and dilution inputs.
  - No section depends on burying raw AskEdgar data inside one prompt string.

#### Step 4 — Enrich Swing Inputs And Persist Thesis Memory

- **Files:** [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts), [`lib/agents/prompts/swing-trader.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/swing-trader.md), [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts)
- **Actions:**
  - Keep the existing OHLC history step and add deterministic indicators from OHLC plus TradingView data: RSI, EMA9, EMA21, relative volume, 5-day/10-day extension, and current move versus prior gap-day outcomes.
  - Use AskEdgar `gap-stats`, `float-outstanding`, `historical-float-pro`, `ownership`, `dilution-rating`, `registrations`, and `offerings` as explicit runner-quality and overhang inputs.
  - Persist a `thesis` memory row per ticker after successful research using `upsertMemory()`, with `valueJson` holding the structured conclusion and `source` tied to the generating report or job.
  - Preserve the rule that the swing report contains no entry, stop, or target levels.
- **Acceptance criteria:**
  - Swing prompt inputs include deterministic technicals.
  - Successful research writes a `thesis` memory row.
  - The report JSON remains traffic-light plus pattern context only.

#### Step 5 — Rebuild Discord Renderers Around Stable Report Families

- **Files:** [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts)
- **Tests:** [`__tests__/agent-discord.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-discord.test.ts)
- **Actions:**
  - Replace generic top-level lookup logic for research-family reports with explicit renderers for small-cap, swing, and macro payloads.
  - Small-cap embed: title should surface ticker plus overall offering risk; render the main traffic-light sections as non-inline fields; render `historicalStats` in a code block for alignment; include source-aware summary text when present.
  - Swing embed: title should surface ticker plus recommendation; render pattern, momentum, catalyst, and volume as non-inline fields; keep `MDR Similarity` visible but contextual.
  - Macro embed: rebuild around the new macro schema instead of `marketBias`, `rates`, `breadth`, `topTheme`, and `watchlist` placeholder keys.
  - Keep `writeAndDeliverReport()` idempotency behavior unchanged.
- **Acceptance criteria:**
  - No report family relies on `readJsonValue()` guessing keys for known contracts.
  - Embeds stop surfacing spurious `n/a` for fields the schema already defines.

#### Step 6 — Redesign The Macro Summary As A Source-Backed Research Object

- **Files:** [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts), [`lib/agents/prompts/orchestrator.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/orchestrator.md), [`lib/agents/prompts/global-policy.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/global-policy.md), [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts), [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts)
- **Tests:** [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts), [`__tests__/agent-context.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts), [`__tests__/agent-macro-summary-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-macro-summary-route.test.ts)
- **Actions:**
  - Replace the thin macro schema with a typed structure built around:
    - `macroDrivers`
    - `crossAssetSnapshot`
    - `scheduledCatalysts`
    - `policyState`
    - `riskMatrix`
    - `deskImplications`
    - `sourceIndex`
    - `confidence`
  - Before the LLM step, normalize source objects into dated, source-backed building blocks: source title, publisher, date, URL, and deterministic snapshot fields.
  - Keep the LLM on synthesis, prioritization, and scenario framing only. Do not let it invent unsupported macro facts.
  - Stop passing raw `JSON.stringify(context.macroSummary)` into the orchestrator chat prompt. Replace it with a compact formatter that extracts the active drivers, biggest scheduled catalysts, and desk implications.
  - Ensure the final stored macro payload matches the Discord renderer and the latest-summary API route exactly.
- **Acceptance criteria:**
  - One macro schema is shared across storage, context, Discord, and API output.
  - Every major macro claim can be traced to an item in `sourceIndex`.

#### Step 7 — Tighten Attribution And Provenance

- **Files:** [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts), [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts), [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts), [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts)
- **Actions:**
  - Replace loose `evidenceIds: string[]` usage with section-level provenance objects or a report-level `sourceIndex` plus section references so each rendered claim can be traced back to specific evidence.
  - Add source URL, title, and date metadata to report JSON for catalyst-heavy sections and macro drivers.
  - Keep social or X inputs as attention signals only. They cannot become primary catalyst evidence without corroboration.
- **Acceptance criteria:**
  - Each multi-section report can identify where its claims came from.
  - Macro and specialist reports expose source URLs in stored JSON.

### Per-File Actions

- [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) — MODIFY
- [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts) — MODIFY
- [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts) — MODIFY
- [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts) — MODIFY
- [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts) — MODIFY
- [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts) — MODIFY
- [`lib/agents/prompts/orchestrator.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/orchestrator.md) — MODIFY
- [`lib/agents/prompts/small-cap.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/small-cap.md) — MODIFY
- [`lib/agents/prompts/swing-trader.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/swing-trader.md) — MODIFY
- [`lib/agents/prompts/jmt-report-format.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/jmt-report-format.md) — MODIFY only if section or provenance rules need tightening
- [`lib/agents/prompts/global-policy.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/global-policy.md) — MODIFY only if the source and provenance contract needs tightening
- [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) — MODIFY
- [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts) — MODIFY
- [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts) — MODIFY only if routed specialist reply metadata requires it
- [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts) — MODIFY
- [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts) — MODIFY
- [`app/api/agents/macro-summary/latest/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/macro-summary/latest/route.ts) — MODIFY
- [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts) — MODIFY
- [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts) — MODIFY or ADD coverage
- [`__tests__/agent-discord.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-discord.test.ts) — MODIFY or ADD coverage
- [`__tests__/agent-service-chat-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-service-chat-route.test.ts) — MODIFY or ADD coverage
- [`__tests__/agent-context.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts) — MODIFY or ADD coverage
- [`__tests__/agent-macro-summary-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-macro-summary-route.test.ts) — MODIFY or ADD coverage
- [`__tests__/agent-reports-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-reports-route.test.ts) — MODIFY or ADD coverage

### Order Of Operations

1. Define the typed report and macro contracts.
2. Persist assistant turns and routed reply metadata.
3. Enrich the small-cap deterministic inputs.
4. Enrich the swing deterministic inputs and thesis memory writes.
5. Rebuild the report renderers.
6. Redesign macro summary storage, rendering, and context formatting.
7. Update the report and macro routes to expose the stable contracts.
8. Refresh tests after each contract boundary instead of only at the end.

### Security Notes

- Keep `TRADINGVIEW_SESSION_ID`, `MASSIVE_API_KEY`, and AskEdgar credentials server-side only.
- Do not expose raw provider payloads or unredacted source blobs to client routes unless they are already safe, compact, and intentional.
- Preserve service-auth separation between the Discord bot and user-authenticated report routes.
- Keep webhook delivery idempotent. Routed specialist replies must not create duplicate Discord posts on retries or restarts.

### Acceptance Criteria

- `agent_conversations` stores both user and assistant turns for orchestrator chat sessions.
- Routed specialist requests post the final specialist result back into `#orchestrator`.
- Small-cap and swing reports ingest explicit deterministic technical and AskEdgar inputs before the LLM step.
- Successful specialist research writes a `thesis` memory row keyed by ticker.
- [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) renders small-cap, swing, and macro reports from explicit contracts, not fallback key guessing.
- The macro summary has one source-backed schema across storage, context, Discord, and API output.
- Routes return stable report metadata and no longer rely on anonymous `unknown` blobs.
- Tests cover the new route contracts, embed layouts, assistant conversation persistence, memory writes, and macro-summary shape.

### Testing Requirements

```bash
npm run lint
npx tsc --noEmit
npm test
```

### Complexity Estimate

- HIGH — this is a cross-cutting contract change touching blueprints, report storage, Discord delivery, routes, context assembly, and tests.
