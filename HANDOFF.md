# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-30
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Recently Completed

### Sprint 10 — Dead-Code Purge + Type-Cast Documentation + Audit Coverage

Status: completed 2026-05-30.

Outcome:
- Deleted the dead scanner MDR-eligibility route + route test, and removed its orphaned helper/result type from `lib/massive-market.ts`. `fetchDailyAggregates` remains intact for the live scanner/agent/cron paths.
- Deleted backend-only generic agent-report list/detail routes + route test, and removed the orphaned validation schema/type exports. The `agentReports` table and its type-specific latest/admin/cron readers were not changed.
- Documented the three accepted `as unknown as` limitations in place, without refactoring signatures or Drizzle mock seams.
- Extended `scripts/workflow-audit.mjs` so `workflow:audit` now checks `HANDOFF.md` and `docs/ARCHITECTURE.md` invariants in addition to the existing workflow assets.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (96 files, 692 tests), and `npm run workflow:audit` all passed.
- Repo-wide grep found no live dangling references for the deleted symbols/routes. The dashboard test's intentional negative assertion that the UI does not fetch the retired scanner route remains.

### Sprint 9 — Agent Job Lease Recovery

Status: completed 2026-05-30 (commit c8ffd89).

Outcome:
- New `recoverExpiredJobs(db, agentId)` in `lib/agents/queue.ts`: two non-fenced bulk updates over expired-lease processing rows (`status='processing' AND lockExpiresAt < now()`, scoped by `agentId`) — FAIL exhausted (`attempt >= maxAttempts`) with a lease-expired message, REQUEUE the rest (`attempt < maxAttempts`) immediately (`nextRetryAt=null`), leaving `leaseVersion`/`startedAt`/`attempt` for the next claim. Returns `{ requeued, failed }`. No migration (reuses existing `idx_agent_jobs_stale`).
- `lib/agents/worker.ts` runs recovery before each claim inside the poll loop, in its own try/catch so a recovery failure logs and falls through instead of breaking the loop; logs only on non-empty recovery. Closes the `docs/repo-cleanup.md` "Expired Agent Job Leases Are Not Recovered" finding.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (98 files, 707 tests) all passed.
- Tests cover requeue/fail counts, the empty case, exact set-payloads (requeue has no `leaseVersion`/`errorMessage`), and a source-string guard on the filter conditions.
- Manual (kill a container mid-job; row clears off `processing` within ~5 min): PENDING post-deploy verification.

### Sprint 8 — Research TLDR Paid-Work Claim + Usage Telemetry

Status: completed 2026-05-29 (commit 458a0a9).

Outcome:
- New `research_tldr_claims` table (ticker PK + `claimed_at`) + migration `0044_optimal_mysterio.sql`. `getCachedResearchTldr(ticker, userId)` now claims per-ticker on a cold miss; concurrent losers poll (8×1500ms) and reuse the winner's cached row instead of double-spending, then generate themselves only if the winner stalls. Stale claims (>90s) cleared at claim time.
- `lib/llm-client.ts` `callLlm` surfaces `usage: { inputTokens, outputTokens }` (defaults 0). TLDR generation now logs tokens/cost/duration to `agent_request_log` via new telemetry-only `recordSiteLlmUsage` (`mode:'site-research-tldr'`) — deliberately NOT `recordLlmAttempt`, so it never mutates the small-cap-trader circuit breaker. Route adds `ensureUser` + threads the user id; response shape unchanged. Closes the `docs/repo-cleanup.md` "Research TLDR Needs A Paid-Work Claim And Unified Telemetry" finding.
- Beneficial drift from spec: a non-unique-violation claim-insert error is logged and swallowed (proceed as owner, skip release) rather than rethrown — better satisfies "claim writes never block the TLDR" than the literal spec, which would have 500'd.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 704 tests) all passed; `npm run db:migrate` applied `0044` cleanly.
- Tests cover usage parse/default-zero, `recordSiteLlmUsage` insert with `db.execute` never called (no-breaker proof), and cache-hit / cold-owner (2 deletes) / failed-telemetry / loser-poll (fake timers, no LLM call) paths.
- Manual browser smoke (one generation for a cold ticker opened twice; `agent_request_log` row for `mode='site-research-tldr'` with non-zero tokens): PENDING user verification.

### Sprint 7 — Slim GET /api/trades Payload (Lazy-Load Executions)

Status: completed 2026-05-29 (commit 757cd32).

Outcome:
- `GET /api/trades` no longer joins `tradeExecutions` — returns one summary row per trade (tags intact, `rawExecutions: []`), so the bulk list loads lighter; `POST` unchanged. Closes the `docs/repo-cleanup.md` "Unbounded GET /api/trades" finding (slim-payload scope; true pagination deferred).
- New `hooks/use-trade-executions.ts`: `useTradeExecutions(id, seeded)` lazy-loads a single trade's executions via `/api/trades/[id]` with a shared module cache + promise-based in-flight dedup; `prefetchTradeExecutions(ids)` warms the same cache. `JournalTradeChart` uses it so replay charts keep per-fill markers; both review sheets prefetch before the auto-print timer so exported PDFs keep per-fill markers.
- Also closed the "Missing GET Test For Trades Route" gap.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (96 files, 696 tests) all passed.
- New GET test asserts `select` ran exactly once (proves the executions query is gone); new hook test covers seeded/seed-transition/lazy-fetch/cache/prefetch.
- Manual browser smoke (Journal + daily/weekly replay markers, detail sheet, multi-fill review PDF export, list load speed): PENDING user verification.

### Sprint 6 — Rate Limiting On Expensive Endpoints

Status: completed 2026-05-29 (commit 644dc24).

Outcome:
- New `rate_limits` table (text PK `${userId}:${endpoint}:${windowStartMs}`, FK cascade, lookup index) + migration `drizzle/0043_fat_timeslip.sql`.
- Shared `lib/rate-limit.ts`: atomic fixed-window (UTC clock-hour) upsert counter + 429 builder with `Retry-After` / `X-RateLimit-*` headers. Caps: research-report 20/hr, askedgar-tldr 30/hr.
- Wired into `POST /api/research-report` and `POST /api/askedgar/tldr` (added a `getDb` guard + one-try/catch restructure to the tldr route).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (95 files, 688 tests) all passed; `npm run db:migrate` applied cleanly.
- Manual post-deploy 429-header smoke: PENDING user verification.

### Multi-Day Trade Replay Charts

Status: completed 2026-05-28 (commit a625032).

Outcome:
- Closed trades spanning >1 day now widen the candle window entry-day→exit-day, place `EXIT` markers on the exit day, and show a date range in the detail-sheet and Journal labels. Open/same-day trades are unchanged.
- Behind an optional `endSortKey` param on `buildTradeChartOptions`; `ResearchChart`/`WatchlistTickerChart` (2-arg callers) untouched. Detection reuses `isCrossDayTrade`/`bucketKey`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (94 files, 681 tests) all passed.
- Codex added `__tests__/ui-trade-utils.test.ts` (3 marker tests) beyond the spec.
- Manual browser smoke (same-day unchanged, multi-day span, ResearchChart unaffected): PENDING user verification.

### CSV Parser: Position-Aware B Resolution

Status: completed 2026-05-28 (commit 5ea235b).

Outcome:
- Lifted DAS Trader's chronological position-resolver into shared `resolveSidesByPositionState` helper in `lib/parsers/utils.ts`.
- `defaultParser` now runs the resolver in `buildContext`, disambiguating raw `B` to `MARGIN` (long open) when no open short exists, or `B` (cover) when one does.
- Deleted `builtinNormalizeRow`; both `processCsvData` and `extractRawExecutions` default to `defaultParser`. Removed `parser.id === 'default'` bypass in `lib/trade-utils.ts`.

Validation:
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed (92 files, 671 tests).
- Manual browser smoke with coworker's 2026-05-28 CSV: PENDING — confirm ASTC/ATPC LONG trades appear, NCT/SPRC SHORT remain correct, ARM shows as open long.

### Cover/Close Entry Flow — Manual Entry (FIFO) + Import Side Resolution

Status: completed 2026-05-28 (commit c846e4a).

Outcome:
- Part A: manual New Trade form now detects an offsetting open position (same symbol, opposite direction) and prompts to close it FIFO instead of creating a new opposite open trade. New `lib/cover-position.ts` (pure FIFO math) + `app/api/trades/cover/route.ts` handle full close / partial / flip; `useTrades.handleCoverPosition` merges affected rows by id.
- Part B: import (raw CSV) path seeds `resolveSidesByPositionState` with the client's currently-open positions so a later-day `B` covering a carried-over short labels as a cover, not a new long. Threaded through `extractRawExecutions` → `collectRawExecutions` → `processImportFiles`.
- Known limits (intentional): multi-day folder import in one action won't link an open+cover across batches; same-symbol intraday round-trip while holding a carried-over position can mislabel. Supported workflow documented for coworkers.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (93 files, 677 tests) all passed.
- Manual browser smoke (Part A confirm/partial/flip/decline, Part B import seeding): PENDING user verification.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
