# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-22
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

---

## Recently Completed

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
