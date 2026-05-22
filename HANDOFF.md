# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-22
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

---

## Recently Completed

### Sprint 3 — Visual Light Mode (Full Token Migration)

Status: completed 2026-05-22 (commit `f0e37e2` + review-pass D5a patches + polish pass).

Outcome:
- Defined warm off-white `:root` palette in `app/globals.css` (`#FAFAF9` bg, `#1C1917` fg, `#059669` primary) plus three new scrollbar CSS vars in both `:root` and `.dark`; scrollbar selectors and `.scrollbar-thin` utility now reference `var(--scrollbar-*)`.
- Added theme toggle (Sun/Moon) as the first item in `SettingsMenu` dropdown with `e.preventDefault()` so the menu stays open; new `components/theme/themed-toaster.tsx` client wrapper reads `useTheme()` and replaces the hardcoded `<Toaster theme="dark" />` in `app/layout.tsx`.
- Migrated ~824 hardcoded color utilities across `app/**` and `components/**` to semantic tokens (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, etc.) while leaving the four chart files (`BacktestChart`, `ResearchChart`, `CandlestickChart`, `ChartDrawings`) hardcoded dark per D4. `ResearchChart` got the single spec-mandated `bg-[#121214] border border-white/10` on its outer flex div.
- Review-pass cleanup: patched four leftover D5a half-migrations (`WatchlistSavePicker:124`, `WatchlistEditor:250`/`652`/`691`/`717`, `BacktestingTab:461-462`) from raw emerald to `primary` tokens. Active-state buttons now use `bg-primary/15 text-primary` so they remain visually distinct in both modes.
- Polish pass — theme contrast + sidebar settings label: Toolbar timeframe selector outlined; PerformanceTab + TradeTable segmented controls unified to `bg-primary/15 text-primary` selected fill; ResearchSubNav now constant-weight `font-semibold` (no shift between states); FilingsSection sub-tabs stay regular-weight; PerformanceCharts chrome (axes, grid, tooltips, ReferenceLine) themed via CSS vars while domain green/red P/L colors stay hardcoded; dropped `bg-black` overrides from Archive + Backtesting Select primitives; `BacktestManagerView.addIconButtonClass` now composes `greenButtonClass`; SettingsMenu trigger now shows "Settings" label when sidebar expanded, mirroring the Account button.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 714 tests) — all green pre- and post-D5a patches.
- Acceptance greps: `bg-[#...]` returns only the four D4 chart files; `bg-zinc-[5-9]|bg-white/[0-9]|border-white/[0-9]|text-zinc-[3-9]` returns empty after the documented exclusions.
- User-run dev-server visual smoke: pass.

### Sprint 2 — Light Mode Infrastructure

Status: completed 2026-05-22 (commit `91dfeb0`).

Outcome:
- Installed `next-themes@^0.4.6` and added `components/theme/theme-provider.tsx` with `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `disableTransitionOnChange`.
- Rewrote `app/layout.tsx`: removed hardcoded `className="dark"`, added `suppressHydrationWarning` on `<html>`, wrapped providers in `ThemeProvider` (outermost) → `SessionProvider` → `MotionConfig`; `Toaster` stays hardcoded `theme="dark"` per D6.
- Refactored `app/globals.css` `@theme inline` to reference per-token CSS vars; added matching `:root` and `.dark` blocks with identical dark-palette values (Sprint 3 will diverge `:root`).
- Sprint 1 follow-up: dropped local `toEpochMs` in `components/trading/BacktestChart.tsx` and pulled it from `@/lib/chart-time`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 714 tests) — all green.
- Static checks: no local `function toEpochMs`, `className="dark"` count = 0, `next-themes` appears once in `package.json`.
- Manual A/B browser smoke + DevTools `localStorage` light/dark swap remain user-run before merge.

### Tier 1 Mechanical Cleanup Pass

Status: completed 2026-05-22 (commit `61858f1`).

Outcome:
- Added `requireUser()` gates to `/api/agents/macro-summary/latest` and `/api/agents/market-pulse/latest`; both now 401 for unauth callers.
- Removed unused `@tailwindcss/typography` dep and broken `next clean` script; refreshed `package-lock.json`.
- Refreshed `docs/ARCHITECTURE.md`, `AGENTS.md`, and `docs/ae-buildout.md` for current helper layout + Ask Edgar scopes; cleared the five completed findings from `docs/repo-cleanup.md`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (714 tests, +2 new auth-rejection cases), `npm run workflow:audit` — all green.
- `npm run clean` correctly reports `Missing script`; zero `@tailwindcss/typography` refs across `package.json` + `package-lock.json`.

### Persist Chart Drawings + Indicators to DB

Status: completed 2026-05-22 (commit `73dcc32`).

Outcome:
- New `chart_drawings` table (PK `(user_id, ticker, bucket)`, `bucket ∈ {intraday, higher}`) with `app/api/chart-drawings` GET/PUT under `requireUser()`.
- `BacktestChartGrid` runs two bucket-keyed controllers; drawings + per-slot indicators persist per `(user, ticker, bucket)` and `BacktestChart.tsx:424` no longer gates draw on `frame.intraday` — daily/weekly/monthly slots can draw too.
- Saved reviews remain read-only and render from `chartState`; `chartStateSchema` accepts both legacy flat and new bucketed shapes (back-compat covered by `normalizeChartState`).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all green (98 files, 712 tests).
- `npm run db:migrate` applied `drizzle/0042_happy_felicia_hardy.sql`.
- Manual smoke (Step 8 paths) still pending user-run dev-server validation.

### Sprint 1 — Pre-Light-Mode Refactors

Status: completed 2026-05-22.

Outcome:
- Added shared `toTime()` in `lib/chart-time.ts` and extracted session-shading rect state/recalculation into `hooks/use-session-shading.ts`.
- Migrated `ResearchChart`, `CandlestickChart`, and `BacktestChart` to the hook while keeping their existing range-change, resize, and initial-layout scheduling triggers.
- Split `ResearchReportSections.tsx` into a thin 41-line dispatcher plus six tab/shared modules under `components/trading/research-report-sections/`; the default export path and caller set stayed unchanged.

Validation:
- Interim `npx tsc --noEmit` passed after Step 2 before any chart call site was migrated.
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all green (98 files, 714 tests).
- Static acceptance checks passed: no local `function toTime` / `function toUTCSeconds` in `components/trading/`, one `useSessionShading` hook call per chart file, exactly six research section files, and unchanged `ResearchReportSections` callers.
- Manual browser smoke for chart shading and five Research sub-tabs remains post-merge/user-run; no dev-server smoke was run in this session.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Open Follow-Ups

- **Offerings extractors fresh-ticker smoke check**: the 2026-05-19 offerings broadening shipped, but the WNW manual smoke was inconclusive because the Research snapshot was cached. Next time Research is opened on a fresh ADS / FPI ticker whose `askedgar_cache` row has expired or does not exist, confirm Shares / Price / Amount populate for at least one priced row in Past Offerings. If every value is `--`, capture the filing URL from the row's SEC link and open a follow-up spec for the missing phrasing variant.
