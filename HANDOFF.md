# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-25
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Sprint 5 - Repo Cleanup Quick Wins

Status: completed 2026-05-25.

Completed scope:
- Wrapped unhandled data-writing trade actions in `withErrorToast` and added `fetchTradeDetail` call-site error feedback.
- Added Zod max bounds to trade and review validation schemas. `date` remains `.max(50)` because live POST/import payloads use ISO datetime strings; `sortKey` keeps the tighter `.max(20)` bound.
- Added `refreshTrades` in-flight deduplication and replaced hook-level `session?.user as` assertions with runtime checks.
- Renamed `lib/trading-utils.ts` to `lib/ui-trade-utils.ts`, updated imports, and changed `parsePrice` from `any` to `unknown`.
- Moved `dotenv` to `devDependencies`; intentionally left `ws` in `dependencies` because agent services require it at runtime.
- Removed the post-import full trade-list fetch from `app/api/trades/import-raw/route.ts`; the client already refreshes after import.

Validation:
- `npm install` - passed; lockfile regenerated.
- `npm run lint` - passed.
- `npx tsc --noEmit` - passed.
- `npx vitest run __tests__/trades-import-route.test.ts __tests__/trades-route.test.ts` - passed after correcting the stale `date` bound.
- `npm test` - passed (92 files, 667 tests).

No manual smoke was run; this sprint had no visual behavior or dev-server requirement.

---

## Next Up: Sprint 6 — Rate Limiting

> Status: NOT YET SPECCED

Scope: DB-backed sliding-window rate limiter for expensive endpoints (`/api/research-report`, `/api/askedgar/tldr`). New `rate_limit_hits` table, shared `lib/rate-limit.ts` helper, integration into target routes, 429 responses with standard headers. See `docs/repo-cleanup.md` § "Rate Limiting On Expensive Endpoints" for the finding.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
