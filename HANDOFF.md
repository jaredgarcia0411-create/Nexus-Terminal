# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-29
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Sprint 10 — Dead-Code Purge + Type-Cast Documentation + Audit Coverage

> Generated: 2026-05-30 | Agent: Claude (Plan)
> Status: READY FOR CODEX

(Second of the remaining `docs/repo-cleanup.md` cleanup batch — see the "Remaining Sprint Plan" there. All deletions and mechanical edits; no user-facing behavior change. Baseline is green as of the Sprint 9 review on 2026-05-30: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (98 files, 707 tests) all passed.)

### Objective

Remove two confirmed-dead route surfaces and their orphaned helpers, convert three silent `as unknown as` casts into documented accepted-limitation comments, and extend `scripts/workflow-audit.mjs` so it actually checks the `HANDOFF.md` and `docs/ARCHITECTURE.md` invariants the audit skill claims it covers. Nothing here changes runtime behavior — it shrinks dead surface area and closes three `docs/repo-cleanup.md` findings (the `mdr-eligibility` deletion, the agent-reports route decision, the `as unknown as` finding, and the `workflow:audit` narrow-check finding).

### Stories

- CLEAN-1001 — Delete `/api/scanner/mdr-eligibility` route + its test, and remove `computeMdrEligibility()` + `MdrEligibilityResult` from `lib/massive-market.ts`.
- CLEAN-1002 — Delete `/api/agents/reports` and `/api/agents/reports/[id]` routes + `__tests__/agent-reports-route.test.ts`, and remove the now-orphaned `reportsListQuerySchema` + `ReportsListQueryInput` from `lib/validations/agents.ts`.
- CLEAN-1003 — Replace the three `as unknown as` casts with the same code plus an explanatory comment documenting the accepted limitation (no signature refactor).
- CLEAN-1004 — Extend `scripts/workflow-audit.mjs` with stable invariant checks for `HANDOFF.md` and `docs/ARCHITECTURE.md`.

### Current State

- **mdr-eligibility (CLEAN-1001):** `app/api/scanner/mdr-eligibility/route.ts` is a thin `GET` wrapper over `computeMdrEligibility(ticker, mark)`. Repo-wide, `computeMdrEligibility` is referenced only by that route + `__tests__/scanner-mdr-eligibility-route.test.ts`. `MdrEligibilityResult` (the interface above it) is used only by `computeMdrEligibility`. The dashboard test (`__tests__/dashboard-scanner-table.test.tsx:226`) asserts the UI never fetches `/api/scanner/mdr-eligibility` — that assertion stays valid (and passing) after the route is gone. **`fetchDailyAggregates` is used widely (swing-trader/orchestrator blueprints, `cron/mdr-sweep`, `massive-market.ts:745`) — do NOT remove it.**
- **agents/reports (CLEAN-1002):** `app/api/agents/reports/route.ts` (list) and `app/api/agents/reports/[id]/route.ts` (detail) are `requireUser`-protected readers of the `agentReports` table. No product/UI code fetches them (verified: the only references outside the route files are inside `__tests__/agent-reports-route.test.ts`). The Research section UI (`ResearchReportPanel`, `ResearchTickerView`, `ResearchTldr`) uses `/api/research-report`, `/api/askedgar/tldr`, `/api/askedgar/snapshot` — none of which touch these routes. The `agentReports` table itself is read by the type-specific `latest` routes (`agents/market-pulse/latest`, `agents/macro-summary/latest`, `agents/admin/stats`, `agents/admin/redeliver`, `cron/market-pulse-eod`), which query the table directly and do NOT go through `/api/agents/reports`. So deleting these two generic routes leaves the table and every live reader intact. `reportsListQuerySchema` and its inferred type `ReportsListQueryInput` (`lib/validations/agents.ts:19,25`) are imported only by the list route → orphaned once it's gone.
- **Casts (CLEAN-1003):** Three `as unknown as` sites: `lib/market-pulse/capture.ts:101` (`db.select()` chain) and `:117` (`db.insert()` chain) — both exist because `MarketPulseDb = Pick<Db, 'insert' | 'select'> & Partial<Pick<Db, 'execute'>>` (line 9) narrows the db so tests can pass a partial mock, but `Pick` drops Drizzle's fluent builder return types so the `.from().where()` / `.values().onConflictDoUpdate()` chains must be typed by hand. `app/api/research-report/route.ts:174` (`db as unknown as Parameters<typeof recordLlmAttempt>[0]`) — `getDb()` returns the site `Db`, while `recordLlmAttempt` (`lib/agents/runtime-limits.ts:171`) takes `AgentDb`; both are the same Drizzle instance over the same schema, just different brand types. None of the three is a hidden bug.
- **Audit script (CLEAN-1004):** `scripts/workflow-audit.mjs` (147 lines) string-checks `AGENTS.md`, `README.md`, `docs/VALIDATION_MATRIX.md`, the vercel-ops skill, and skill-file existence, but never reads `HANDOFF.md` or `docs/ARCHITECTURE.md` — even though `codex-skills/nexus-workflow-audit/SKILL.md` lists both as audit targets. The script uses a simple `read(rel)` + `check(condition, message)` pattern and exits non-zero with a failure list. `docs/ARCHITECTURE.md` exists (the route-auth conventions are stated at its line 53; "Never `db:push`" at line 154). `HANDOFF.md` ends with a `## Session Maintenance` section in every revision.

### Scope

- **In scope:** the four deletions/edits above, plus the audit-script extension and its required HANDOFF/ARCHITECTURE invariant strings.
- **Out of scope:** Do NOT refactor the casts (no widening of `recordLlmAttempt`'s signature, no change to `MarketPulseDb`) — documenting them is the locked decision (D3). Do NOT touch `fetchDailyAggregates`, the `agentReports` table, the schema, or any `latest`/cron route. Do NOT change the audit skill's `SKILL.md` text (the skill already lists these targets; we're making the script match the skill, not the reverse). No new env vars, no migration, no product/UI change. Provider-client consolidation (TradingView/Massive) is Sprint 11 — leave it alone even though `massive-market.ts` is touched here.

### Decisions Locked For Sprint 10

- **D1. `computeMdrEligibility` + `MdrEligibilityResult` are deleted, `fetchDailyAggregates` is kept.** The eligibility helper is dead (route-only); the aggregates fetch it depends on is shared infrastructure. Verified via repo-wide grep.
- **D2. The agent-reports routes are deleted (not kept+documented).** Confirmed no product consumer and that the Research section's reports use a completely separate route (`/api/research-report`). Deleting the generic list/detail endpoints does not affect the `agentReports` table or its type-specific `latest`-route readers. This matches the user's instruction: "if [the research section] doesn't use this route then we can delete both routes + test."
- **D3. The three casts are documented, not refactored.** Each is an accepted Drizzle/brand-type limitation, not a hidden bug; refactoring working market-pulse and telemetry paths for type cosmetics carries risk with no behavior benefit. Keep the exact same code, add a one-line comment above each cast explaining why it's there. (Comment text is given verbatim in Planned File Actions — use it as written.)
- **D4. `workflow:audit` is extended, not merely documented.** Per the user's choice, add real checks so the command matches what the skill claims. The HANDOFF.md check is **positive-only** (a structural anchor): forbidden-substring checks must NOT be used on HANDOFF.md because it legitimately names retired systems while a cleanup sprint is active (a fanout review caught this self-reference trap). Forbidden-reference checks belong only on stable published docs (README.md, docs/ARCHITECTURE.md). Never assert sprint-specific strings. Follow the existing `read()` + `check()` style exactly; do not restructure the script.

### Planned File Actions

**Deleted files:**

- `app/api/scanner/mdr-eligibility/route.ts`
- `__tests__/scanner-mdr-eligibility-route.test.ts`
- `app/api/agents/reports/route.ts`
- `app/api/agents/reports/[id]/route.ts`  *(after deleting both files, the now-empty `app/api/agents/reports/` and `app/api/agents/reports/[id]/` directories should be removed too)*
- `__tests__/agent-reports-route.test.ts`

**Modified files:**

- `lib/massive-market.ts` — Delete the `export interface MdrEligibilityResult { ... }` block (starts at line ~334) **and** the entire `export async function computeMdrEligibility(...) { ... }` (starts at line ~349, runs to its closing brace). Leave everything else — especially `fetchDailyAggregates` and `fetchGroupedDailyAggregates` — untouched. After deletion, confirm no remaining reference to either deleted symbol in the file.

- `lib/validations/agents.ts` — Delete the `export const reportsListQuerySchema = z.object({ ... });` block (line ~19) and the `export type ReportsListQueryInput = z.infer<typeof reportsListQuerySchema>;` line (~25). Leave all other exports in the file intact. If removing them leaves an unused `z` import, only remove the import if `z` is now unused in the whole file (grep first — it's almost certainly still used by other schemas).

- `lib/market-pulse/capture.ts` — Keep both casts' code exactly as-is; add a comment line directly above each.
  - Above `const rows = await ((db.select() as unknown as {` (line ~101):
    ```ts
    // MarketPulseDb narrows db to a Pick<> so tests can pass a partial mock, but
    // Pick drops Drizzle's fluent builder return types — so select().from().where()
    // is typed by hand here. Accepted Drizzle/Pick limitation, not a hidden bug.
    ```
  - Above `await (db.insert(marketPulseDailyStats) as unknown as {` (line ~117):
    ```ts
    // Same Drizzle/Pick limitation as loadBarsForDates: the narrowed db drops
    // insert()'s fluent builder types, so values().onConflictDoUpdate() is typed by hand.
    ```

- `app/api/research-report/route.ts` — Keep the cast; add a comment directly above `const telemetryDb = db as unknown as Parameters<typeof recordLlmAttempt>[0];` (line ~174):
  ```ts
  // recordLlmAttempt wants AgentDb; getDb() returns the structurally-identical site
  // Db (same Drizzle instance over the same schema). The cast bridges the two brand
  // types — widening recordLlmAttempt's signature is out of scope here.
  ```

- `scripts/workflow-audit.mjs` — Following the existing `read()` + `check()` pattern (place these blocks alongside the other top-level checks, before the `if (includeCrossTool)` block), add:
  ```js
  // HANDOFF.md is a rotating work-contract: it legitimately NAMES retired systems
  // whenever a sprint is about removing them, so forbidden-substring checks do not
  // belong here (they would fail mid-sprint on the spec's own text). Only assert the
  // structural anchor that every revision must keep.
  const handoff = read('HANDOFF.md');
  check(
    handoff.includes('## Session Maintenance'),
    'HANDOFF.md should keep its `## Session Maintenance` section.',
  );

  const architecture = read('docs/ARCHITECTURE.md');
  check(
    architecture.includes('requireCronSecret()') && architecture.includes('requireUser()'),
    'docs/ARCHITECTURE.md should document the requireUser()/requireCronSecret() auth conventions.',
  );
  check(
    architecture.includes('maxDuration = 60'),
    'docs/ARCHITECTURE.md should document the SSE `maxDuration = 60` convention.',
  );
  check(
    architecture.includes('Never `db:push`'),
    'docs/ARCHITECTURE.md should keep the "Never `db:push`" migration rule.',
  );
  check(
    !/Jarvis|JARVIS_|Schwab/i.test(architecture),
    'docs/ARCHITECTURE.md should not reference retired Jarvis/Schwab systems.',
  );
  ```
  All asserted strings are present in the current files (verified), so the audit stays green during and after this sprint — including while this Sprint 10 spec itself is still in HANDOFF.md. (The HANDOFF.md check is positive-only on purpose: a fanout review caught that negative forbidden-substring checks on HANDOFF.md are self-referential — the spec text discussing a cleanup names the very systems being removed — and would fail mid-sprint. Negative reference checks stay on the stable published docs, README.md and docs/ARCHITECTURE.md, only.) The ARCHITECTURE.md checks are convention anchors, not sprint-specific content.

### Acceptance Criteria

- [ ] `app/api/scanner/mdr-eligibility/route.ts` and `__tests__/scanner-mdr-eligibility-route.test.ts` are deleted; `computeMdrEligibility` + `MdrEligibilityResult` are gone from `lib/massive-market.ts`; `fetchDailyAggregates` and all other exports remain.
- [ ] `app/api/agents/reports/route.ts`, `app/api/agents/reports/[id]/route.ts`, and `__tests__/agent-reports-route.test.ts` are deleted (and the emptied route directories removed); `reportsListQuerySchema` + `ReportsListQueryInput` are removed from `lib/validations/agents.ts` with no other export disturbed.
- [ ] The three `as unknown as` casts are unchanged in behavior but each now has the documenting comment above it (verbatim as specified).
- [ ] `scripts/workflow-audit.mjs` reads `HANDOFF.md` and `docs/ARCHITECTURE.md` and checks the listed invariants; `npm run workflow:audit` passes.
- [ ] No schema/migration, no new env var, no product/UI behavior change; `fetchDailyAggregates`, the `agentReports` table, and all `latest`/cron readers are untouched.
- [ ] Full validation gauntlet passes (see below).

### Validation

Run before marking COMPLETE:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run typecheck:services` (`lib/massive-market.ts` is imported by `services/` agent blueprints)
- `npm test` (expect 2 fewer test files — the two deleted route tests; remaining suite green)
- `npm run workflow:audit` (HANDOFF.md changed + the audit script itself changed)

### Notes for Codex

- After deletions, do a repo-wide grep for each deleted symbol/route path (`computeMdrEligibility`, `MdrEligibilityResult`, `reportsListQuerySchema`, `ReportsListQueryInput`, `/api/agents/reports`) to confirm no dangling import or reference remains outside the dashboard test's negative assertion (which is expected to stay).
- The dashboard test line asserting the UI does NOT call `/api/scanner/mdr-eligibility` is correct to leave in place — it's a guard, not a consumer.

---

## Recently Completed

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
