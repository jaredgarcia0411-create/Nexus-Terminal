# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-12
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

### Cleanup Step 3: Delete 4 dead API routes + 3 dead schemas (with migration)

> Generated: 2026-05-12 | Author: planning conversation (cleanup audit `docs/repo-cleanup.md`)
> Status: COMPLETED — implemented and validated 2026-05-12
> Executor: Codex
> Validation: `npm run db:generate`, inspected `drizzle/0031_whole_wendell_vaughn.sql`, `npm run db:migrate`, `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test`, `npm run workflow:audit`, final grep returned zero TS/TSX matches after clearing stale `.next` metadata.

#### Goal

Step 3 of the cleanup roadmap. **Removals only — no refactors.** Two categories:

1. **Dead API routes (4)** — verified zero callers in `app/`, `lib/`, `services/`, `components/`, `hooks/`:
   - `app/api/saved-tickers/route.ts` — backend-only, no UI consumer.
   - `app/api/market-data/daily-summary/route.ts` — backend-only, no UI consumer.
   - `app/api/agents/research/route.ts` — POST is duplicated by `orchestrator-chat` blueprint (direct DB insert into `agentJobs`); GET has no readers. Discord uses `/api/agents/service/chat`. Site uses the separate `/api/research-report` system. Agent specialists keep working without this route.
   - `app/api/askedgar/lookup/route.ts` — superseded by `/api/askedgar/snapshot`. `ResearchTickerView.tsx:44` is the only research caller and it already uses `snapshot`.

2. **Dead DB schemas (3)** — only the deleted routes (or nothing) imported them:
   - `savedTickers` — only imported by the route being deleted.
   - `dailyTickerSummaries` — only imported by the route being deleted.
   - `agentMemory` — zero importers (active code uses `agentMemoryV2`).

Plus the test files for the four routes and the now-dead `researchPostSchema` in `lib/validations/agents.ts`.

A new Drizzle migration drops the three tables. Two live doc references get updated; sprint-history docs are intentionally untouched.

#### Locked decisions

- All three tables get dropped via a single new Drizzle migration file. Do **not** use `db:push` (causes false positives on this repo's composite PKs and corrupts migration history — see `feedback_db_migrate_over_push.md`).
- Use `npm run db:generate` to create the migration file, inspect the generated SQL, then `npm run db:migrate` to apply.
- `lib/validations/agents.ts`: `researchPostSchema` and `ResearchPostInput` are only used by `app/api/agents/research/route.ts` — drop them in this spec.
- `docs/AGENTIC_EXPANSIONV2.md` and `.opencode/` references stay alone — those are historical sprint records.
- Tests for deleted routes get deleted alongside.
- `app/api/market-data/route.ts` (the parent route, not the subdir) stays — only the `daily-summary` subdir is removed.

---

#### Phase 1 — Delete the 4 route files and their tests

**Action:** DELETE 8 files.

1. Delete `app/api/saved-tickers/route.ts` (then remove the now-empty `app/api/saved-tickers/` directory).
2. Delete `app/api/market-data/daily-summary/route.ts` (then remove the now-empty `app/api/market-data/daily-summary/` directory; leave `app/api/market-data/route.ts` and the parent directory in place).
3. Delete `app/api/agents/research/route.ts` (then remove the now-empty `app/api/agents/research/` directory).
4. Delete `app/api/askedgar/lookup/route.ts` (then remove the now-empty `app/api/askedgar/lookup/` directory).
5. Delete `__tests__/saved-tickers-route.test.ts`.
6. Delete `__tests__/market-data-daily-summary-route.test.ts`.
7. Delete `__tests__/agent-research-route.test.ts`.
8. Delete `__tests__/askedgar-lookup-route.test.ts`.

**Validation after Phase 1:** `npx tsc --noEmit` should pass — no remaining file imports these routes or their tests.

---

#### Phase 2 — Drop dead `researchPostSchema` from `lib/validations/agents.ts`

**File:** `lib/validations/agents.ts`
**Action:** MODIFY

1. Delete lines 27–32:
   ```ts
   export const researchPostSchema = z.object({
     ticker: z.string().regex(/^[A-Z]{1,5}$/),
     agent_id: z.enum(['small-cap-trader', 'swing-trader']),
   });

   export type ResearchPostInput = z.infer<typeof researchPostSchema>;
   ```
2. Leave the blank line spacing tidy — collapse adjacent blank lines so the next export (`adminMemoryListQuerySchema`) follows one blank line after `redeliverSchema`/`reportsListQuerySchema`.

**Validation after Phase 2:** `npx tsc --noEmit` and `npm run lint` should both pass.

---

#### Phase 3 — Remove schema objects and generate the drop migration

**File:** `lib/db/schema.ts`
**Action:** MODIFY

1. Delete the `agentMemory` export block at lines 110–123 (the entire `export const agentMemory = pgTable('agent_memory', { ... })` definition including the `}, (table) => [ ... ]);` closing block).
2. Delete the `dailyTickerSummaries` export block at lines 139–156 (entire export).
3. Delete the `savedTickers` export block at lines 158–168 (entire export).
4. Leave all surrounding exports (`brokerSyncHistory`, `researchReports`, `askedgarCache`, etc.) and their comments unchanged. Tidy any leftover double-blank-lines.

**Then generate and apply the migration:**

5. Run `npm run db:generate`. This creates a new file at `drizzle/0031_<name>.sql` containing three `DROP TABLE` statements.
6. Open the generated SQL and confirm it only contains:
   - `DROP TABLE "agent_memory" CASCADE;` (or equivalent)
   - `DROP TABLE "daily_ticker_summaries" CASCADE;`
   - `DROP TABLE "saved_tickers" CASCADE;`
   And no other table changes. If anything else appears, stop and surface it — the schema delta is wrong.
7. Run `npm run db:migrate` to apply the migration to the database.
8. The `drizzle/meta/_journal.json` and `drizzle/meta/0031_snapshot.json` will be updated automatically by `db:generate`. Commit those alongside the SQL file.

**Validation after Phase 3:** `npx tsc --noEmit` and `npm run lint` pass; the migration applied cleanly (no errors from `db:migrate`).

---

#### Phase 4 — Update live doc references

Two live docs reference deleted routes. Update them; leave sprint-history docs alone.

**File:** `codex-skills/nexus-askedgar-debug/SKILL.md`
**Action:** MODIFY

1. At line 25, delete the bullet `   - \`/api/askedgar/lookup\`` so the surface list becomes:
   ```
   1. Identify the failing surface:
      - `/api/askedgar/snapshot`
      - `/api/askedgar/tldr`
      - `lib/research.ts`
      - agent blueprints under `lib/agents/blueprints/`
   ```

**File:** `docs/FUTURE-PLANS.md`
**Action:** MODIFY

2. At line 397, change:
   ```
   - Read APIs already exist: `app/api/agents/reports/route.ts`, `app/api/agents/reports/[id]/route.ts`, `app/api/agents/research/route.ts`, `app/api/agents/macro-summary/latest/route.ts`.
   ```
   to:
   ```
   - Read APIs already exist: `app/api/agents/reports/route.ts`, `app/api/agents/reports/[id]/route.ts`, `app/api/agents/macro-summary/latest/route.ts`.
   ```
3. At line 428, delete the entire bullet:
   ```
   - **No user-facing job polling for research** — `POST /api/agents/research` queues but has no first-class status endpoint for the site.
   ```
   The bullet above it (`**Discord-locked service route**`) and the bullet below it (`**Conversation history scope too broad**`) should sit on consecutive lines after the deletion.

**Do not** edit `docs/AGENTIC_EXPANSIONV2.md`, `.opencode/` snapshots, or `docs/repo-cleanup.md` — those are historical records.

---

#### Phase 5 — Final validation

Run from repo root, in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run typecheck:services` (the services entrypoint imports from `lib/` and `lib/db/schema.ts` is in that path)
4. `npm test`
5. Final dead-code grep:
   ```bash
   grep -rn "saved-tickers\|savedTickers\|daily-summary\|dailyTickerSummaries\|api/agents/research\|askedgar/lookup\|agentMemory\b\|researchPostSchema\|ResearchPostInput" \
     --include='*.ts' --include='*.tsx' .
   ```
   Should return only matches inside `.opencode/`, `docs/repo-cleanup.md`, `docs/AGENTIC_EXPANSIONV2.md`, and historical learn notes — all of which are intentionally left alone. Zero matches in live `app/`, `lib/`, `services/`, `components/`, `hooks/`, `__tests__/`.

If anything fails, stop and surface the failure. Do not commit half-finished state.

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `app/api/saved-tickers/route.ts` | DELETE (+ empty dir) | Low |
| `app/api/market-data/daily-summary/route.ts` | DELETE (+ empty dir) | Low |
| `app/api/agents/research/route.ts` | DELETE (+ empty dir) | Low |
| `app/api/askedgar/lookup/route.ts` | DELETE (+ empty dir) | Low |
| `__tests__/saved-tickers-route.test.ts` | DELETE | Low |
| `__tests__/market-data-daily-summary-route.test.ts` | DELETE | Low |
| `__tests__/agent-research-route.test.ts` | DELETE | Low |
| `__tests__/askedgar-lookup-route.test.ts` | DELETE | Low |
| `lib/validations/agents.ts` | Drop `researchPostSchema` + `ResearchPostInput` (lines 27–32) | Low |
| `lib/db/schema.ts` | Drop `agentMemory`, `dailyTickerSummaries`, `savedTickers` exports | Low |
| `drizzle/0031_<auto>.sql` | NEW — generated DROP TABLE migration | Medium |
| `drizzle/meta/_journal.json` | AUTO-UPDATED by `db:generate` | Low |
| `drizzle/meta/0031_snapshot.json` | NEW — generated by `db:generate` | Low |
| `codex-skills/nexus-askedgar-debug/SKILL.md` | Remove `/api/askedgar/lookup` bullet (line 25) | Low |
| `docs/FUTURE-PLANS.md` | Remove `/api/agents/research` ref (line 397) + delete bullet at line 428 | Low |

#### Acceptance Criteria

- [x] All 4 route files and their parent directories are deleted from the working tree.
- [x] All 4 test files are deleted.
- [x] `lib/validations/agents.ts` no longer exports `researchPostSchema` or `ResearchPostInput`.
- [x] `lib/db/schema.ts` no longer exports `agentMemory`, `dailyTickerSummaries`, or `savedTickers`.
- [x] A new `drizzle/0031_whole_wendell_vaughn.sql` migration exists, contains only the three `DROP TABLE` statements, and has been applied via `npm run db:migrate`.
- [x] `codex-skills/nexus-askedgar-debug/SKILL.md:25` no longer lists `/api/askedgar/lookup`.
- [x] `docs/FUTURE-PLANS.md` line 397 no longer references `app/api/agents/research/route.ts` and line 428's bullet is removed.
- [x] `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, and `npm test` all pass.
- [x] Final grep returns zero matches in live `app/`, `lib/`, `services/`, `components/`, `hooks/`, `__tests__/`.

#### Out of scope

- Step 4 cost/reliability fixes (POST idempotency, runtime-limits routing for site reports, AskEdgar caps in Postgres, dashboard aggregate endpoint).
- Step 5 refactors (askedgar split, tradingview client extraction, client cache hook).
- Step 6 docs drift compaction.
- Updating sprint history (`docs/AGENTIC_EXPANSIONV2.md`, `.opencode/learn/`, `docs/repo-cleanup.md`) — intentional.

---

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

- Any other entries in `docs/repo-cleanup.md` (cost/reliability fixes, refactors, docs drift). Those are Steps 4–6.
- Updating `.opencode/reports/` historical audit snapshots — they are timestamped records and should not be edited retroactively.

---

## Cleanup Plan Roadmap

The full cleanup is sequenced as removals first, then fixes, then refactors. Each step gets its own HANDOFF spec when we're ready to execute it.

1. **Step 1 (COMPLETED 2026-05-11):** Discord research import stack + Schwab dead deps.
2. **Step 2 (COMPLETED 2026-05-12):** High-confidence dead code: `WeeklyCalendar`, `ResearchGainersList`, `HorizontalLinePrimitive`, `fetchAndCacheRawReport()`, plus the stale comment in `app/api/research-report/route.ts:52`.
3. **Step 3 (COMPLETED 2026-05-12):** Deleted 4 dead routes (`saved-tickers`, `market-data/daily-summary`, `/api/agents/research`, `/api/askedgar/lookup`), their tests, dead `researchPostSchema`, 3 dead schemas (`agentMemory`, `dailyTickerSummaries`, `savedTickers`) plus Drizzle migration `0031_whole_wendell_vaughn.sql`, and two live doc refs (askedgar-debug skill, FUTURE-PLANS bullets).
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
