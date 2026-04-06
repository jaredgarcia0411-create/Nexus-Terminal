# Test Audit Report

**Scope**: Full
**Date**: 2026-04-06
**Test Files Found**: 22

---

## Critical Issues

1. `__tests__/askedgar-client.test.ts` — `beforeEach` resets modules and restores spies, but does not call `vi.clearAllMocks()`. This is the only suite with a `beforeEach` missing the standard mock-clear step and increases cross-test leakage risk.

## Warning Issues

1. `__tests__/server-db-utils.test.ts` — several assertions target query-builder internals (`insertValues`, `updateSet`, `conflictUpdate`) rather than observable behavior.
2. `__tests__/trade-id-route.test.ts` — GET/PATCH coverage leans on mocked helper call shapes (`toTradeMock`, insert/delete/update mock wiring) more than route output behavior.
3. `__tests__/market-data-route.test.ts` — success-path assertions inspect raw `fetch.mock.calls[0][0]` query construction, which is brittle to harmless refactors.
4. `__tests__/research-tab.test.tsx` and `__tests__/charts-tab.test.ts` — string-matching `renderToStaticMarkup()` smoke tests are copy-coupled and do not verify user-visible behavior through the rendered DOM.
5. `__tests__/saved-tickers-route.test.ts` and `__tests__/market-data-daily-summary-route.test.ts` — nearly identical auth/db hoisted setup could be consolidated into shared helpers.

## Good Pattern Examples

1. `__tests__/askedgar-snapshot-route.test.ts` — good `vi.hoisted()` + `vi.mock()` setup with explicit `requireUserMock` defaults in `beforeEach`.
2. `__tests__/trades-bulk-route.test.ts` — good local `makeDb()` factory for shaping DB behavior without repeating mock chains in each test.
3. `__tests__/trades-route.test.ts` — good `requireUserMock` usage with focused `makeDb()` setup for route-specific persistence behavior.
4. `__tests__/trades-import-route.test.ts` — good auth mocking with `requireUserMock`, plus targeted DB factory for import batch scenarios.

## Notes

- No test files without assertions were found.
- No un-restored spy leaks were found beyond the missing `vi.clearAllMocks()` pattern above.
