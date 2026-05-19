# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-19
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

## Current Context

- Phase 4 multi-day calendar spans shipped earlier. Later fixes anchored `closedAt` at noon UTC and changed `isCrossDayTrade` / `TradingCalendar` span keys to compare against `trade.sortKey`, preserving overnight and multi-day behavior without date-only UTC rollback.
- The current follow-up fixes two display/data bugs in the trade surfaces:
  - Trade dates in the Trades table and detail sheet could display one local day early because API `date` values like `"2026-05-19"` were normalized with `new Date("YYYY-MM-DD")`, which parses as midnight UTC.
  - `/api/trades/import-raw` matched trade executions but did not persist execution rows for newly matched same-day trades or new open positions, leaving Trade Details with an empty Executions table after import.
- Open parked items unrelated to active work: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, Backtest Manager `broke_premarket_high`.

## Active Work Status

Status: validated on 2026-05-19, not committed.

Implemented in the current worktree:

- `lib/trade-utils.ts` now normalizes `Trade.date` from the canonical `sortKey` at local midnight, avoiding UTC date-only rollback while keeping `sortKey` as the source of truth.
- `components/trading/TradeDetailSheet.tsx` now renders the header date from `sortKey` and uses entry/exit time text instead of formatting the parsed `Date` timestamp.
- `lib/position-matcher.ts` now carries matched raw executions on same-day matched trades and new open positions.
- `app/api/trades/import-raw/route.ts` now persists those matched executions into `trade_executions`, updates `executionCount` / `executions`, and keeps the existing closing-fill path intact.
- Regression coverage was added in:
  - `__tests__/trade-utils.test.ts`
  - `__tests__/position-matcher.test.ts`
  - `__tests__/trades-import-raw-route.test.ts`

Validation passed:

```bash
npx vitest run __tests__/trade-utils.test.ts __tests__/position-matcher.test.ts __tests__/trades-import-raw-route.test.ts
npm run lint
npx tsc --noEmit
npm test
npm run workflow:audit
```

## Required Validation Before Handoff

Run from repo root before future handoff closure:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run workflow:audit` because this file changed

No `services/` files were touched, so `npm run typecheck:services` is not required.

## Manual Review Notes

- In Trades, date display should no longer roll back to the previous local day for date-only DB rows.
- In Trade Details, imported raw trades should show their execution rows after import/refresh.
- Calendar overnight and multi-day behavior should remain based on `bucketKey(trade)` and `trade.sortKey`; open trades still do not render as realized overnight spans.

## Session Maintenance Checklist

- [ ] Read this file before starting.
- [ ] If the active context drifts from the live repo, update the context or stop and ask before editing.
- [ ] Run required validation before reporting the work complete.
- [ ] Do not push to remote without explicit user instruction.
- [ ] Do not modify `.env*` or secret files.
