# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-12
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

### Cleanup Step 2: Delete high-confidence dead components + `fetchAndCacheRawReport`

> Generated: 2026-05-11 | Author: planning conversation (cleanup audit `docs/repo-cleanup.md`)
> Status: COMPLETED — implemented and validated 2026-05-12
> Executor: Codex
> Validation: Phase 1 `npx tsc --noEmit`; Phase 2 `npx tsc --noEmit`, `npm run lint`; final `npm run lint`, `npx tsc --noEmit`, `npm test`, dead-code grep returned zero matches.

#### Goal

Step 2 of the cleanup roadmap. **Removals only — no refactors.** All four targets were verified dead with `rg` immediately before this spec was written:

- `WeeklyCalendar.tsx` — only self-references; Journal uses `TradingCalendar`.
- `ResearchGainersList.tsx` — only self-references; current Research tab does not import it.
- `HorizontalLinePrimitive.ts` — zero callers; horizontal lines are drawn via `series.createPriceLine()` in the chart component (the file is a stale type-only stub).
- `fetchAndCacheRawReport()` in `lib/research.ts` — zero callers; the snapshot route uses `getCachedTickerData()` directly. Deleting it makes several `lib/research.ts` imports dead, which we drop in the same change.

The stale comment in `app/api/research-report/route.ts:52` references `fetchAndCacheRawReport()` and gets updated since the function it cites is being deleted.

#### Locked decisions

- Sibling primitives (`FibonacciPrimitive.ts`, `RectanglePrimitive.ts`, `TrendLinePrimitive.ts`) **stay** — only `HorizontalLinePrimitive.ts` is dead.
- The defensive `if (latest?.reportJson)` check in `app/api/research-report/route.ts` **stays** — older DB rows seeded by the old `fetchAndCacheRawReport()` may still have `reportJson = null`. Only the comment changes.
- `lib/research.ts` keeps `getCachedTickerData`, `AskEdgarResponse`, `callLlm`, `isObject`, `parseJson`, `trimRawDataForLlm`, `collectRawDataWarnings`, `buildResearchTldrPrompt`, `runResearchTldr`. The drizzle/db imports become unused after the function is removed — they get dropped in the same edit.
- No tests reference any of these symbols (verified). No test edits needed.

---

#### Phase 1 — Delete the three dead component files

**Goal:** Remove dead UI files. Pure deletes; no consumers.

1. Delete `components/trading/WeeklyCalendar.tsx`.
2. Delete `components/trading/ResearchGainersList.tsx`.
3. Delete `components/trading/plugins/HorizontalLinePrimitive.ts`.

**Validation after Phase 1:** `npx tsc --noEmit` should pass — none of these files are imported anywhere.

---

#### Phase 2 — Delete `fetchAndCacheRawReport` and drop dead imports in `lib/research.ts`

**File:** `lib/research.ts`
**Action:** MODIFY

1. Delete the entire `fetchAndCacheRawReport` function (currently lines 125–197, including the `/** Fetch AskEdgar data... */` doc comment that precedes it on lines 125–128).
2. Update the `runResearchTldr` doc comment (currently lines 199–202). Replace:
   ```ts
   /**
    * Generate a compact TLDR from AskEdgar data for the research tab display.
    * Expects rawData from fetchAndCacheRawReport() or fetchTickerData().
    */
   ```
   with:
   ```ts
   /**
    * Generate a compact TLDR from AskEdgar data for the research tab display.
    * Expects rawData from getCachedTickerData().
    */
   ```
3. Drop the now-unused imports at the top of the file:
   - Remove `and, desc, eq, gte` from the `drizzle-orm` import (line 1) — delete the whole import line; nothing else in this file uses drizzle helpers.
   - Remove the `getDb` import from `@/lib/db` (line 3) — delete the whole line.
   - Remove the `researchReports` import from `@/lib/db/schema` (line 4) — delete the whole line.
4. The remaining imports at the top of the file should be exactly:
   ```ts
   import { getCachedTickerData } from '@/lib/askedgar';
   import type { AskEdgarResponse } from '@/lib/askedgar';
   import { callLlm } from '@/lib/llm-client';
   ```

**Validation after Phase 2:** `npx tsc --noEmit` and `npm run lint` should both pass.

---

#### Phase 3 — Update the stale comment in `app/api/research-report/route.ts`

**File:** `app/api/research-report/route.ts`
**Action:** MODIFY

1. Replace the two-line comment at lines 52–53:
   ```ts
   // Only return rows with a structured report_json - early-day rows seeded by
   // fetchAndCacheRawReport() leave reportJson null. Treat those as "no fresh report".
   ```
   with a single line:
   ```ts
   // Older rows can have reportJson=null from legacy seeding; treat them as "no fresh report".
   ```
2. Do not change the `if (latest?.reportJson)` check itself or any surrounding logic.

**Why we keep the null check:** historical rows in the `research_reports` table may still carry `reportJson = null` from past use of the deleted seeder. The defensive check is still correct; only the comment was citing a function that no longer exists.

---

#### Phase 4 — Final validation

Run from repo root, in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. Final dead-code grep:
   ```bash
   grep -rn "WeeklyCalendar\|ResearchGainersList\|HorizontalLinePrimitive\|fetchAndCacheRawReport" \
     --include='*.ts' --include='*.tsx' .
   ```
   Should return **zero matches** outside `.opencode/reports/` (which contains historical audit snapshots — intentionally left alone) and `docs/repo-cleanup.md` (the audit doc — historical reference, intentionally left alone).

If anything fails, stop and surface the failure. Do not commit half-finished state.

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `components/trading/WeeklyCalendar.tsx` | DELETE | Low |
| `components/trading/ResearchGainersList.tsx` | DELETE | Low |
| `components/trading/plugins/HorizontalLinePrimitive.ts` | DELETE | Low |
| `lib/research.ts` | Delete `fetchAndCacheRawReport` + drop 3 dead import lines + docstring fix | Low |
| `app/api/research-report/route.ts` | Replace stale 2-line comment with 1-line comment (line 52–53) | Low |

#### Acceptance Criteria

- [x] All three component files are deleted from the working tree.
- [x] `lib/research.ts` no longer exports `fetchAndCacheRawReport`.
- [x] `lib/research.ts` only imports `getCachedTickerData`, `AskEdgarResponse`, and `callLlm`.
- [x] `runResearchTldr`'s doc comment no longer mentions `fetchAndCacheRawReport`.
- [x] `app/api/research-report/route.ts` line 52 comment no longer mentions `fetchAndCacheRawReport`; the `if (latest?.reportJson)` check is unchanged.
- [x] `npm run lint` passes.
- [x] `npx tsc --noEmit` passes.
- [x] `npm test` passes.
- [x] Final grep for the four identifiers returns zero matches in `*.ts` / `*.tsx` outside `.opencode/reports/`.

#### Out of scope

- Step 3 medium-confidence removals (`saved-tickers`, `daily-summary`, `/api/agents/research`, `/api/askedgar/lookup`, legacy `agentMemory` schema). Each needs a product-side decision first.
- Any other entries in `docs/repo-cleanup.md` (cost/reliability fixes, refactors, docs drift). Those are Steps 4–6.
- Updating `.opencode/reports/` historical audit snapshots — they are timestamped records and should not be edited retroactively.

---

## Cleanup Plan Roadmap

The full cleanup is sequenced as removals first, then fixes, then refactors. Each step gets its own HANDOFF spec when we're ready to execute it.

1. **Step 1 (COMPLETED 2026-05-11):** Discord research import stack + Schwab dead deps.
2. **Step 2 (COMPLETED 2026-05-12):** High-confidence dead code: `WeeklyCalendar`, `ResearchGainersList`, `HorizontalLinePrimitive`, `fetchAndCacheRawReport()`, plus the stale comment in `app/api/research-report/route.ts:52`.
3. **Step 3 — Medium-confidence removals (decision pass):** Walk through saved-tickers, market-data/daily-summary, `/api/agents/research` direct route, `/api/askedgar/lookup`, and legacy `agentMemory` schema. Each needs a product-side decision before deletion. Backend-only routes may have manual cURL consumers you forgot about.
4. **Step 4 — Cost/reliability fixes:** Make `/api/research-report` POST idempotent (DB-backed ticker claim to prevent duplicate paid LLM calls); route site-report LLM usage through `lib/agents/runtime-limits.ts` budget telemetry; move AskEdgar daily-cap + retry-window state into Postgres (module memory resets on Vercel cold start, so today's caps are advisory only). Add one short-TTL server aggregate endpoint for the dashboard scanner polling.
5. **Step 5 — Refactors (only after pruning):** Split `lib/askedgar.ts` (1,462 lines) into `endpoints` / `fanout` / `cache` / `snapshot-normalizer`. Extract `lib/tradingview-client.ts` for shared TradingView scan logic. Replace module-level client caches in `ResearchTldr`, `ResearchReportPanel`, `MacroSummaryPanel`, `use-candle-data` with one TTL-aware resource hook.
6. **Step 6 — Docs drift:** Compact `HANDOFF.md` after Step 5 (or sooner if it gets stale again). Update `README.md` env-var section (`JARVIS_*` → `LLM_*` / `BACKGROUND_LLM_*`). Update `docs/VALIDATION_MATRIX.md` (refs deleted `services/backtest-*`). Sync `codex-skills/nexus-vercel-ops/SKILL.md` and `docs/FUTURE-PLANS.md` cron counts (now 2 after Step 1, not 3). Update `AGENTS.md` validation-file count.

Codex-skills sync work is intentionally **excluded** from this roadmap per user direction.

---

## Recently Completed Summary

- 2026-05-12: Cleanup Step 2 removed dead `WeeklyCalendar`, `ResearchGainersList`, and `HorizontalLinePrimitive` files; deleted `fetchAndCacheRawReport()` from `lib/research.ts`; and replaced the stale research-report route comment. Validation passed.
- 2026-05-11: Cleanup Step 1 removed the retired Discord research import stack, dropped `imported_research_reports` and `ticker_research_summaries` via `drizzle/0030_freezing_charles_xavier.sql`, removed the Discord sync cron/root env stubs, and uninstalled the unused Schwab package/spec. TLDR now runs on AskEdgar data only.
- 2026-05-07: Research Report wiring (site endpoint + auto-cache + Research tab panel), TLDR risk-ranked refactor (`{ findings, historicalContext }`), and Research-tab empty-state polish. Code-validated; authenticated/manual browser smoke pending.
- 2026-05-07: Research tab refresh shipped (8 → 5 tabs, Dilution rewrite, auto-TLDR, Overview rebuild, conditional chart). Then Dilution Rating + chart-less header polish, `overall_offering_risk` mapped from AskEdgar dilution-rating endpoint, Overview titles bumped to `text-base`, inner-scroll restructure.
- 2026-05-05: Dashboard scanner completion — split PM/AH gainers scan with combined volume gating, MDR scanner with `mdr_triggers` table + nightly cron + dashboard merging of live and recent rows. Threshold values render as prices/percentages.
- 2026-05-04: Backtesting UI refinements plus grid layout and sample-set sidebar (`b03fa38`, `82bfa46`, `10e1071`, `82cca14`, `36a410b`).
- 2026-05-03: Backtesting chart drawing/indicator persistence and review save-flow fixes (`82cbb55`, `88a4da4`, `6513e40`).
- 2026-05-01: Backtest Manager landing page shipped: schema, API, manager, stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred. Data is not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
- 2026-05-07 Research Report bundle: authenticated/manual browser smoke still unchecked.
