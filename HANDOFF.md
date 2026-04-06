# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

---

## AEV2 Sprint 1 Phase 1 — Contract Surface

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Objective

Implement the Sprint 1 Phase 1 contract surface only, then stop for review before schema and migration work.

### Delivered

- Added [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts) as the pure V1 agent contract module:
  - agent/job/report/step unions
  - LLM, blueprint, memory, worker, and token-tracking interfaces
  - `BlueprintValidationError` and `BudgetExceededError`
- Added [`lib/agents/llm-client.ts`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts) as the Docker-side dual-lane LLM wrapper:
  - `getInteractiveLlmConfig()`
  - `getBackgroundLlmConfig()`
  - `getLlmBudgetConfig()`
  - `callLlm(request, lane, overrides)`
- Added [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts) with pure header/body auth helpers:
  - `requireAgentAdmin()`
  - `requireServiceAuth()`
  - empty hardcoded Discord-to-Nexus mapping scaffold with full user-shape examples
- Added the Phase 1 prompt stack under [`lib/agents/prompts/`](/home/jared/Nexus-Terminal/lib/agents/prompts):
  - [`global-policy.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/global-policy.md)
  - [`orchestrator.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/orchestrator.md)
  - [`small-cap.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/small-cap.md)
  - [`swing-trader.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/swing-trader.md)
- Stopped at the Phase 1 boundary. No schema, migration, or database-apply work has started.

### Validation

- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅

### Next Step

- Review Phase 1 contract choices, then proceed to Sprint 1 Phase 2: schema + generated migration artifacts.

---

## AEV2 Sprint 1 Implementation Guide

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Objective

Review the Sprint 1 draft in `AEV2_PLAN.md`, resolve the contract ambiguities, and turn it into a commit-friendly implementation guide that names the exact files and order of operations.

### Delivered

- Reworked Sprint 1 in `AEV2_PLAN.md` into a three-phase implementation plan:
  - Phase 1: `lib/agents` contract surface
  - Phase 2: schema + generated Drizzle artifacts
  - Phase 3: seed SQL + migration apply + final verification
- Fixed the `AEV2-101` guidance so it no longer contradicts itself about whether `lib/agents/types.ts` should import from `lib/types.ts`.
- Fixed the `AEV2-103` service-auth contract so it now matches `AGENTIC_EXPANSIONV2.md`:
  - `requireServiceAuth(request, body)`
  - returns `{ user, discordUserId }`
  - hardcoded Discord mapping stores full user identities rather than only user IDs
- Corrected the migration guidance to reflect real Drizzle outputs:
  - `drizzle/0019_*.sql`
  - `drizzle/meta/0019_snapshot.json`
  - `drizzle/meta/_journal.json`
- Clarified that the only intentional manual edit to the generated migration is the appended AEV2-204 seed block.

### Validation

- Final validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅

---

## Auth Skill Port

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Objective

Port the remaining high-value auth workflow guidance into `codex-skills/` so Codex sessions can load the current protected-route and NextAuth patterns directly.

### Delivered

- Added `codex-skills/auth-constraints/SKILL.md` as a Codex-native port of the existing auth guidance.
- Rewrote the source material around the live repo reality:
  - NextAuth JWT sessions in `lib/auth-config.ts`
  - `requireUser()` / `ensureUser()` in `lib/server-db-utils.ts`
  - `parseAndValidate()` plus Zod v4 error formatting in `lib/api-route-utils.ts`
  - middleware protection in `middleware.ts`
- Dropped stale guidance from the OpenCode version that no longer matches the repo, including the incorrect note about avoiding NextAuth.
- Copied the installed skill into `/home/jared/.codex/skills/` so future Codex sessions can auto-discover it.

### Validation

- Reviewed against:
  - `.opencode/skills/auth-constraints/SKILL.md`
  - `lib/auth-config.ts`
  - `lib/server-db-utils.ts`
  - `lib/api-route-utils.ts`
  - `middleware.ts`
- Verified installed skill path:
  - `/home/jared/.codex/skills/auth-constraints`
- Final validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅

---

## Additional Codex Skill Ports

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Objective

Port the remaining high-value workflow skills into `codex-skills/` so future Codex sessions can grab them directly for DB work, test audits, and Vercel operations.

### Delivered

- Added `codex-skills/drizzle-conventions/SKILL.md` as a Codex-native port of the existing Drizzle guidance, rewritten around the live repo files:
  - `lib/db.ts`
  - `lib/db/schema.ts`
  - `lib/server-db-utils.ts`
  - current bulk-write route patterns
- Added `codex-skills/test-auditor/SKILL.md` as a Codex-native test audit skill, replacing the OpenCode-specific subagent workflow with a local Codex audit process that matches current Vitest patterns in `__tests__/`.
- Added `codex-skills/nexus-vercel-ops/SKILL.md` as a repo-specific Vercel operations skill for this linked Vercel project, centered on:
  - `.vercel/project.json`
  - `vercel.json`
  - the existing Vercel plugin skills and MCP tools
- Copied the installed skills into `/home/jared/.codex/skills/` so future Codex sessions can auto-discover them.

### Validation

- Reviewed against:
  - `.opencode/skills/drizzle-conventions/SKILL.md`
  - `.opencode/skills/test-auditor/SKILL.md`
  - live DB helpers and schema files
  - current `__tests__/` patterns
  - `.vercel/project.json`
  - `vercel.json`
- Verified installed skill paths:
  - `/home/jared/.codex/skills/drizzle-conventions`
  - `/home/jared/.codex/skills/test-auditor`
  - `/home/jared/.codex/skills/nexus-vercel-ops`
- Final validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅

---

## Commit Workflow Skill Port

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Objective

Port the repo's existing custom commit command into a Codex-native skill and tighten it for mixed worktrees and repo-specific artifact handling.

### Delivered

- Added `codex-skills/nexus-commit/SKILL.md` as the Codex-native port of the existing commit workflow.
- Kept the core stage/commit/push flow from `.claude/commands/commit.md` and `.opencode/commands/commit.md`, but tightened it with:
  - required validation before commit for code changes
  - path-scoped staging guidance for dirty worktrees
  - explicit treatment of `.opencode/learn/` and `.opencode/reports/` as opt-in commit material
  - support for stopping after a local commit when push is not requested
- Updated `AGENTS.md` so future command ports from `.claude/commands/` and `.opencode/commands/` are expected to land in `codex-skills/` and stay aligned.
- Copied the installed skill to `/home/jared/.codex/skills/nexus-commit/SKILL.md` so future Codex sessions can auto-discover it.

### Validation

- Reviewed against:
  - `.claude/commands/commit.md`
  - `.opencode/commands/commit.md`
  - `codex-skills/nexus-handoff/SKILL.md`
  - `codex-skills/nexus-workflow-audit/SKILL.md`
- Verified installed skill path:
  - `/home/jared/.codex/skills/nexus-commit`
- Final validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅

---

## Codex Workflow Skill Ports

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Objective

Review the repo's existing agent, skill, and custom-command assets, then port the repo-specific workflows that are worth preserving into Codex-friendly skill sources.

### Delivered

- Audited `.claude/agents/`, `.claude/commands/`, `.claude/skills/`, and `.opencode/agents/` for value and drift.
- Chose not to port the generic executor-style agents because they duplicate Codex's built-in execution behavior.
- Chose not to port stale command text that still references deleted Jarvis/Schwab systems or older auth/hook patterns.
- Added repo-maintained Codex skill sources:
  - `codex-skills/nexus-frontend-design/SKILL.md`
  - `codex-skills/nexus-frontend-design/references/design-system.md`
  - `codex-skills/nexus-handoff/SKILL.md`
  - `codex-skills/nexus-workflow-audit/SKILL.md`
- Copied the reviewed skill directories into `/home/jared/.codex/skills/` so future Codex sessions can auto-discover them.
- Updated `AGENTS.md` so future sessions know where the repo-maintained Codex skill sources live.

### Validation

- Verified installed skill paths:
  - `/home/jared/.codex/skills/nexus-frontend-design`
  - `/home/jared/.codex/skills/nexus-handoff`
  - `/home/jared/.codex/skills/nexus-workflow-audit`
- Validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅

---

## AEV2 Sprint Doc Sync

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Objective

Make `AEV2_PLAN.md` the authoritative sprint-execution document, synchronize `AGENTIC_EXPANSIONV2.md` to current repo reality, and trim stale execution detail so both docs are safe to use for worktree planning.

### Delivered

- Declared `AEV2_PLAN.md` the source of truth for sprint execution, sequencing, and launch gates.
- Tightened the sprint plan so the initial worktree critical path is EPIC-1 through EPIC-4, with `AEV2-007` and `AEV2-311` explicitly moved to a parallel seed-data track.
- Strengthened key acceptance criteria for agent auth, lease fencing, checkpoints, idempotent Discord delivery, service-route contracts, and launch-hardening work.
- Raised the baseline validation bar in the plan to match repo expectations: `npm run lint`, `npx tsc --noEmit`, and `npm test`.
- Converted `AGENTIC_EXPANSIONV2.md` into an architecture/reference document synced to current repo reality.
- Removed stale migration/backfill guidance, old Jarvis/Markets cleanup phases, duplicate build-order/file-inventory sections, and volatile prompt/seed workflow detail that now belongs in `AEV2_PLAN.md` or implementation files.
- Added clear current-reality notes to `AGENTIC_EXPANSIONV2.md` so planned `lib/agents/*`, `/api/agents/*`, and service runtime files are distinguished from code that already exists today.

### Validation

- Documentation review completed against current repo state, `HANDOFF.md`, and active service/env files.
- Validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅

---

## Test Quality Quick Wins

> Generated: 2026-04-06 | Agent: Remi
> Status: COMPLETE

### Objective

Implement the critical test-isolation fix and all audit quick wins: add DOM test support with `@testing-library/react` + `jsdom`, replace brittle component smoke tests with behavior tests, add direct coverage for the untested AskEdgar/TradingView routes, and reduce implementation-detail assertions in the existing server/route tests.

### Delivered

- Added `@testing-library/react` and `jsdom`, updated `package-lock.json`, and enabled conditional Testing Library cleanup in `vitest.setup.ts` without switching the global Vitest environment to jsdom.
- Fixed the AskEdgar client mock-isolation issue by clearing mocks before module restore/reset in `__tests__/askedgar-client.test.ts`.
- Added direct route coverage for:
  - `GET /api/askedgar/lookup`
  - `POST /api/askedgar/tldr`
  - `GET /api/tradingview/gainers`
- Replaced the static markup smoke tests for `ResearchTab` and `ChartsTab` with jsdom behavior tests focused on visible user interactions.
- Reduced implementation-detail coupling in `__tests__/server-db-utils.test.ts` and simplified the success-path assertions in `__tests__/market-data-route.test.ts`.
- Ran focused Vitest coverage for every touched test file while building.

### Validation

- Focused test runs completed for:
  - `__tests__/askedgar-client.test.ts`
  - `__tests__/askedgar-lookup-route.test.ts`
  - `__tests__/askedgar-tldr-route.test.ts`
  - `__tests__/tradingview-gainers-route.test.ts`
  - `__tests__/research-tab.test.tsx`
  - `__tests__/charts-tab.test.ts`
  - `__tests__/server-db-utils.test.ts`
  - `__tests__/market-data-route.test.ts`
- Final validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅
- Manual visual-check items: none performed; this was a test-only spec.

---

## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)

Minor follow-ups from the 2026-03-29 review; none block sprint import.
- **R8:** Deduplicate repeated `step_log` guidance; replace the duplicate with a cross-reference to Section 3.2.
- **R9:** Keep "multi-agent fanout deferred to V2" only in the Executive Summary and Section 13 closing note; trim the other repeats to cross-references.
- **R10:** Make Section 20 Discord Adapter reference Section 13 for the 120s/60-attempt polling timeout instead of restating it.
- **M2:** Clarify in Section 19 that the budget is enforced per-agent, so `$5/day` across 3 agents means `$15/day` total.
- **M3:** Add `idempotencyKey: 'swing-research-{ticker}-{date}'` to `swing:research` step 6 metadata.
- **M4:** State that Vercel routes use `getDb()` from `lib/server-db-utils.ts` and Docker workers use `getAgentDb()` from `lib/agents/db.ts`; never mix them.
- **B11:** Add `chat-helpers.ts` and `historical-summary.ts` to the Phase 7 delete list in Section 18.
- **B15/B18:** Audit existing `services/discord-bot/` contents before Phase 5 Step 44, and define `services/.env.example` from Docker Compose `environment:` blocks.

---

## Build Spec — Three-Phase Simplification

> Generated: 2026-04-03 | Agent: nexus-architect
> Status: COMPLETE

### Objective

Replace the AskEdgar gainers list in Research tab with TradingView screener data, remove the Jarvis tab and all its infrastructure, remove the Markets tab and its Schwab/relay infrastructure. The result is a 6-tab app with a leaner `lib/` directory and no dead Schwab/relay code.

## Phase 1: TradingView Screener as Top Gainers Source

**Status:** COMPLETE

### Delivered

- Added authenticated TradingView screener route at `app/api/tradingview/gainers/route.ts`.
- Replaced Research tab gainers source with TradingView data in `components/trading/ResearchGainersList.tsx`.
- Added near-real-time polling every 60 seconds plus LIVE / 15-MIN DELAY badge based on `TRADINGVIEW_SESSION_ID`.
- Removed the legacy AskEdgar gainers route and deleted the empty `app/api/askedgar/gainers/` directory.
- Manual validation completed: Research sidebar selection still updates the ticker view, and the LIVE / 15-MIN DELAY badge behavior was confirmed.

---

## Phase 2: Remove Jarvis Tab

**Status:** COMPLETE

### Delivered

- Relocated `lib/jarvis/askedgar.ts` → `lib/askedgar.ts`, `lib/jarvis/client.ts` → `lib/llm-client.ts`, and `lib/jarvis/research.ts` → `lib/research.ts`.
- Inlined `DilutionDataSourceCheck` into `lib/askedgar.ts` and `buildResearchTldrPrompt` into `lib/research.ts`, eliminating `lib/jarvis/types.ts` and `lib/jarvis/prompts.ts` dependencies.
- Updated all AskEdgar routes to use the new shared library paths.
- Reduced the shell to a 6-tab app by removing Jarvis and Markets from `app/page.tsx`, `components/trading/Sidebar.tsx`, `components/trading/CommandPalette.tsx`, and `hooks/use-global-shortcuts.ts`.
- Deleted Jarvis UI files, Jarvis API routes, `lib/validations/jarvis.ts`, the full `lib/jarvis/` directory, 11 Jarvis tests, and `.claude/commands/jarvis-prompt-tuner.md`.
- Preserved Discord historical summary refresh behavior by inlining the former `updateTickerSummary` logic into `lib/discord/client.ts` before deleting `lib/jarvis/historical-summary.ts`.
- Removed `macro_summaries`, `jarvis_conversations`, and `jarvis_request_log` from `lib/db/schema.ts`, then generated and applied `drizzle/0017_magical_nocturne.sql`.
- Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test`, and grep for `@/lib/jarvis/` returned zero TypeScript/TSX matches.

---

## Phase 3: Remove Markets Tab

**Status:** COMPLETE

### Delivered

- Deleted the remaining Markets UI and scanner infrastructure: `components/trading/MarketsTab.tsx`, `components/trading/ScannerSection.tsx`, `hooks/use-market-stream.ts`, `hooks/use-relay-socket.ts`, `hooks/use-schwab-status.ts`, and `hooks/use-scanner.ts`.
- Removed Markets / Schwab / relay API routes and cleaned the empty route directories while preserving `app/api/market-data/route.ts` and `app/api/market-data/daily-summary/route.ts`.
- Deleted Markets-specific libraries plus `lib/schwab/`, removed `services/schwab-relay/`, and deleted obsolete route/component tests tied to the removed infrastructure.
- Dropped `market_snapshots`, `schwab_links`, `realtime_quotes`, and `scanner_presets` from `lib/db/schema.ts`, then generated and applied `drizzle/0018_nasty_warbird.sql`.
- Updated `.claude/CLAUDE.md` and `AGENTS.md` to reflect the 6-tab app, 17 API routes, 7 hooks, `lib/askedgar.ts`, and the removal of Schwab relay guidance.

### Validation

- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅
- Grep checks for `@/lib/jarvis/`, `@/lib/schwab`, `MarketsTab`, `JarvisTab`, `use-market-stream`, `use-relay-socket`, `use-schwab-status`, and `use-scanner` returned zero TypeScript/TSX matches.
- Verified kept files still exist: `app/api/market-data/route.ts`, `app/api/market-data/daily-summary/route.ts`, `lib/massive-market.ts`, `lib/askedgar.ts`, `lib/llm-client.ts`, `lib/research.ts`, `app/api/tradingview/gainers/route.ts`.

---

## Security Note

- `TRADINGVIEW_SESSION_ID` is read only server-side — never sent to the client
- Removed Schwab OAuth routes eliminate that attack surface entirely
- All remaining routes still use `requireUser()` auth

## Manual Steps (outside this spec)

- [ ] Add `TRADINGVIEW_SESSION_ID=<value>` to `.env.local` (get from TradingView DevTools → Cookies)
- [ ] Add `TRADINGVIEW_SESSION_ID` to Vercel environment variables
- [ ] Destroy Fly.io relay: `fly apps destroy nexus-schwab-relay`
- [ ] Remove Schwab OAuth app credentials (revoke at developer.schwab.com)
- [ ] Remove Jarvis/LLM env vars from Vercel (`JARVIS_API_KEY`, `JARVIS_API_BASE_URL`, `JARVIS_MODEL`, `JARVIS_ADMIN_KEY`)

---

## Condense intradayNotes

These entries in `scripts/trade-examples-template.json` have intradayNotes that are too long (~500-630 chars). Target ~350-400 chars max. Keep the key entries, adds, stops, and covers but cut the play-by-play detail.

Work through these one at a time, reviewing the screenshot alongside each entry.

### Must condense (~550-630 chars)

1. **PAVM 1-21-26** (~630 chars) — 3 separate entry attempts, lots of price detail
2. **KLTO 6-10-25** (~600 chars) — 3 entry attempts with many adds, very granular price tracking
3. **BNAI 1-26-26** (~600 chars) — long entry sequence + re-entry attempt at the end
4. **USO 3-9-26** (~570 chars) — multiple entry/re-entry cycles with detailed price levels
5. **NAMM 1-28-26** (~560 chars) — many small adds across PM, open, and AH
6. **EVTV 1-13-26** (~530 chars) — detailed stop/re-entry sequence
7. **AMCI 12-15-25** (~530 chars) — includes SPAC context explanation that could be moved to dailyNotes

### Borderline (~500-520 chars, condense if possible)

8. **GITS 1-27-26** (~520 chars)
9. **ROLR 1-14-26** (~510 chars)
