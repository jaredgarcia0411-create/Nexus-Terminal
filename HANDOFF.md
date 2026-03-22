# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4, SSE Jarvis Streaming, Discord Research Schwab Validation, Research Tab Full Redesign, Direct Relay WebSocket) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

---

## Schwab Relay Auth — Parallel Blocker

> Generated: 2026-03-16 | Status: OPEN

- Relay logs show repeated `Failed to load Schwab user preference (401)`.
- This keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- Schwab refresh tokens expire every **7 days** — you need to re-login via the Schwab OAuth flow weekly.

### Next steps

1. Re-link Schwab account in the app (Markets tab → Schwab status)
2. After relinking, check Fly logs for `LOGIN successful, subscribing...` and quote-write activity
3. If 401 persists after fresh relink, investigate whether the relay is loading the correct tokens from the DB

---

## Macro Summary Upgrade — Better Sources, Expanded Report

> Generated: 2026-03-22 | Agent: claude-plan + nexus-architect
> Status: COMPLETE
> Priority: MEDIUM — improves daily pre-market intelligence quality
> Risk: LOW — no schema migration, no new files, no new API routes

### Delivered

- Expanded macro cron sources to 8 targeted URLs, removed Federal Reserve/CNN homepage sources, and updated JSON fallback to include `economic_calendar`.
- Added optional `economic_calendar` typing to macro summary interfaces for backward compatibility with older stored rows.
- Updated macro system/prompt instructions to require `economic_calendar[]` and increased macro summary budget to 500 words.
- Updated Markets macro summary UI with new reference links and conditional Economic Calendar rendering (between 2-column grid and risk section).
- Restricted both Vercel macro cron schedules to weekdays only (`1-5`).
- Updated route/component tests for new source set and economic calendar behavior, including backwards-compat rendering coverage.

### Files Changed

- `app/api/jarvis/cron/macro-summary/route.ts`
- `lib/jarvis/types.ts`
- `lib/jarvis/prompts.ts`
- `components/trading/JarvisMacroSummary.tsx`
- `vercel.json`
- `__tests__/jarvis-macro-summary-route.test.ts`
- `__tests__/jarvis-macro-summary-component.test.ts`

### Validation

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/jarvis-macro-summary-route.test.ts`
- [x] `npx vitest run __tests__/jarvis-macro-summary-component.test.ts`
- [x] `npm test`
- [ ] Manual deploy check: trigger cron `?force=1`, confirm `/api/jarvis/macro-summary/latest` includes `economic_calendar`
- [ ] Manual UI check: Markets tab shows Economic Calendar section when data exists
- [ ] Manual UI check: old summaries without `economic_calendar` hide section and render normally
