# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-28
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Sprint 6 — Rate Limiting On Expensive Endpoints

> Generated: 2026-05-29 | Agent: Claude (Plan)
> Status: COMPLETE — VALIDATED

### Objective

Add a per-user hourly rate limit to the two LLM/Ask-Edgar-billing endpoints so a runaway `useEffect` loop or a curious user can't run up unbounded external cost. Delivers a `rate_limits` table, a shared `lib/rate-limit.ts` helper (atomic fixed-window counter), and 429 responses with standard headers wired into `POST /api/research-report` and `POST /api/askedgar/tldr`. Implements the `docs/repo-cleanup.md` § "Rate Limiting On Expensive Endpoints" finding.

### Stories

- AEV2-601 — `rate_limits` table + migration
- AEV2-602 — `lib/rate-limit.ts` shared helper (counter + 429 builder)
- AEV2-603 — Wire the limiter into the two target routes
- AEV2-604 — Tests for the helper and both routes

### Current State

- `POST /api/research-report` (`app/api/research-report/route.ts`) already does `requireUser()` → `getDb()`/`dbUnavailable()` → `parseAndValidate(request, postSchema)` → `ensureUser(db, authState.user)` → in-progress claim → generation. No rate limit. `ensureUser` is what remaps a session id to the canonical DB id (it can mutate `authState.user.id`).
- `POST /api/askedgar/tldr` (`app/api/askedgar/tldr/route.ts`) does `requireUser()` → `parseAndValidate(request, tldrSchema)` → `getCachedResearchTldr(ticker)`. It does **not** currently call `getDb()` at all — this sprint adds a `getDb()`/`dbUnavailable()` guard so the limiter has a db handle.
- `getDb()` is exported from `lib/db.ts` and returns `Db | null` (`Db = NeonHttpDatabase<typeof schema>`). Routes use the `const db = getDb(); if (!db) return dbUnavailable();` pattern.
- `dbUnavailable()` is exported from `lib/server-db-utils.ts` and returns `Response.json({ error: 'Database not configured' }, { status: 503 })`.
- Schema lives in `lib/db/schema.ts`. `pgTable`, `text`, `integer`, `timestamp`, `index`, and `users` are all already imported there. Existing rows use a `text('id').primaryKey()` + `references(() => users.id, { onDelete: 'cascade' })` pattern (see `researchReports` at the `research_reports` table).
- Latest migration on disk is `drizzle/0042_happy_felicia_hardy.sql`; the new one will be `drizzle/0043_*.sql` (drizzle-kit auto-names the slug).
- Route tests live in `__tests__/research-report-route.test.ts` and `__tests__/askedgar-tldr-route.test.ts`; they mock collaborators with `vi.hoisted` + `vi.mock` and import the route handlers directly.

### Scope

- **In scope:** the `rate_limits` table + migration; `lib/rate-limit.ts`; edits to the two routes above; new/extended tests listed under Acceptance Criteria.
- **Out of scope:** rate-limiting any other route; a pruning/cleanup cron for old `rate_limits` rows (row volume is tiny for a small team — revisit only if it grows); Redis or any external store; changing the existing in-progress claim / cache logic in either route; client-side handling of 429 (the existing fetch callers already surface errors).

### Decisions Locked For Sprint 6

- **D1. Fixed hourly window, not sliding.** The window is the current clock hour in **UTC** (minutes/seconds/ms zeroed). It's simpler than a sliding window, resets predictably, and is implemented as one atomic upsert. The cleanup doc's `(user_id, endpoint, window_start, count)` shape maps directly onto this.
- **D2. Deterministic text PK, no composite key.** Row id = `` `${userId}:${endpoint}:${windowStartMillis}` `` as a `text` primary key. This sidesteps the composite-PK `db:push` false-positive this repo has hit before, and lets the upsert use the PK as its single conflict target. A non-unique index on `(user_id, endpoint, window_start)` is added for future cleanup queries only.
- **D3. Limit key = `authState.user.id` (session id), checked before `ensureUser`.** We rate-limit on the session id rather than the canonical id so the limiter doesn't have to run a user upsert on every call. This accepts the rare edge case where a session id differs from the canonical DB id (a migration artifact `ensureUser` handles) — worst case a user briefly gets a second bucket. Acceptable for a small team; simplicity wins.
- **D4. Caps: research-report = 20/hour, askedgar-tldr = 30/hour.** Stored in a `RATE_LIMITS` const in `lib/rate-limit.ts`. Research report is the expensive one (14+ external calls + an LLM call), so it gets the tighter cap.
- **D5. Count every well-formed authenticated POST.** The check runs after `requireUser` + `getDb` + `parseAndValidate`, before any work. So a 401 (unauth) or 400 (bad JSON / bad ticker) does **not** consume quota, but every valid attempt does — including ones that turn out to be cache hits. Blocked requests still increment the counter (harmless; keeps them blocked).
- **D6. 429 shape.** Body `{ error: 'Rate limit exceeded. Try again later.' }`; headers `Retry-After` (seconds until window reset), `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix epoch seconds of window end).
- **D7. Migration generated, never pushed.** Codex edits `schema.ts`, runs `npm run db:generate`, and commits the generated `drizzle/0043_*.sql`. Applying it (`npm run db:migrate`) happens against a real database — see Validation. Do **not** run `npm run db:push`.

### Planned File Actions

**New files:**

- `lib/rate-limit.ts` — the shared helper. Exact contract:

  ```ts
  import { sql } from 'drizzle-orm';
  import { getDb } from '@/lib/db';
  import { rateLimits } from '@/lib/db/schema';

  type RateLimitDb = NonNullable<ReturnType<typeof getDb>>;

  // Research report fires 14+ external calls + an LLM call, so it gets the
  // tighter cap. Both reset at the top of each clock hour, per user.
  export const RATE_LIMITS = {
    'research-report': 20,
    'askedgar-tldr': 30,
  } as const;

  export type RateLimitEndpoint = keyof typeof RATE_LIMITS;

  const WINDOW_MS = 60 * 60 * 1000; // 1 hour fixed window

  export interface RateLimitResult {
    limited: boolean;
    limit: number;
    remaining: number;
    resetAt: Date;            // end of the current window
    retryAfterSeconds: number;
  }

  // Top of the current clock hour, in UTC.
  function windowStart(now: Date): Date {
    const d = new Date(now);
    d.setUTCMinutes(0, 0, 0);
    return d;
  }

  // Atomic fixed-window counter: one upsert increments the row for
  // (user, endpoint, hour) and returns the new count. count > limit => limited.
  export async function checkRateLimit(
    db: RateLimitDb,
    userId: string,
    endpoint: RateLimitEndpoint,
    now: Date = new Date(),
  ): Promise<RateLimitResult> {
    const limit = RATE_LIMITS[endpoint];
    const start = windowStart(now);
    const resetAt = new Date(start.getTime() + WINDOW_MS);
    const id = `${userId}:${endpoint}:${start.getTime()}`;

    const [row] = await db
      .insert(rateLimits)
      .values({ id, userId, endpoint, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.id,
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    // returning() always yields a row for insert-or-update on neon-http, so
    // `?? 1` is a type-narrowing fallback only and is never hit in practice.
    const count = row?.count ?? 1;
    const limited = count > limit;
    const retryAfterSeconds = limited
      ? Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))
      : 0;

    return { limited, limit, remaining: Math.max(0, limit - count), resetAt, retryAfterSeconds };
  }

  export function rateLimitResponse(result: RateLimitResult): Response {
    return Response.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfterSeconds),
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
        },
      },
    );
  }
  ```

- `__tests__/rate-limit.test.ts` — unit tests for the helper (see Acceptance Criteria). Stub the db so the upsert returns a controlled count — replicate this chain shape and parameterize `count` per case:

  ```ts
  function createRateLimitDb(count: number) {
    const returning = vi.fn(async () => [{ count }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    return { insert, values, onConflictDoUpdate, returning };
  }
  ```

  Cast it to the helper's db param (`as unknown as Parameters<typeof checkRateLimit>[0]`). Pass a fixed `now` (e.g. `new Date('2026-05-29T14:37:12.000Z')`) so the window/id are deterministic, and assert `values` was called with `windowStart` at minute/second/ms zero and `id` ending in that hour's epoch-ms.

**Modified files:**

- `lib/db/schema.ts` — add the `rateLimits` table. Place it near `researchReports`. `index` is already imported. Exact definition:

  ```ts
  export const rateLimits = pgTable('rate_limits', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  }, (table) => [
    index('rate_limits_user_endpoint_idx').on(table.userId, table.endpoint, table.windowStart),
  ]);
  ```

- `app/api/research-report/route.ts` — in `POST`, add the import `import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';` and insert the check **immediately after** `const { ticker } = bodyState.data;` and **before** `const user = await ensureUser(db, authState.user);`:

  ```ts
  const rate = await checkRateLimit(db, authState.user.id, 'research-report');
  if (rate.limited) return rateLimitResponse(rate);
  ```

- `app/api/askedgar/tldr/route.ts` — add a db guard and the rate check, and **restructure the handler so the whole body is inside one `try/catch`, matching `research-report/route.ts`'s pattern** (currently the tldr `try` wraps only `getCachedResearchTldr`). This ensures a DB throw from `checkRateLimit` is caught by `logRouteError('askedgar-tldr', error)` + `internalServerError()` rather than escaping as an unlogged 500. New imports: `import { getDb } from '@/lib/db';`, add `dbUnavailable` to the existing `@/lib/server-db-utils` import, and `import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';`. New handler body, in order, all inside the `try`:

  ```ts
  export async function POST(request: Request) {
    try {
      const authState = await requireUser();
      if ('error' in authState) return authState.error;

      const db = getDb();
      if (!db) return dbUnavailable();

      const bodyState = await parseAndValidate(request, tldrSchema);
      if (bodyState.error) return bodyState.error;
      const { ticker } = bodyState.data;

      const rate = await checkRateLimit(db, authState.user.id, 'askedgar-tldr');
      if (rate.limited) return rateLimitResponse(rate);

      const result = await getCachedResearchTldr(ticker);
      return Response.json({ ticker, ...result, generatedAt: new Date().toISOString() });
    } catch (error) {
      logRouteError('askedgar-tldr', error);
      return internalServerError();
    }
  }
  ```

- `__tests__/research-report-route.test.ts` — add `vi.mock('@/lib/rate-limit', ...)` with a hoisted `checkRateLimitMock` defaulting (in `beforeEach`) to `{ limited: false, limit: 20, remaining: 20, resetAt: new Date(), retryAfterSeconds: 0 }`, and use the real `rateLimitResponse` (`...(await vi.importActual('@/lib/rate-limit'))`). This is required — without the mock the real helper would call `db.insert(...).onConflictDoUpdate(...)`, which the existing simple db mocks don't implement. Add one test: when `checkRateLimitMock` resolves `{ limited: true, ... retryAfterSeconds: 1800 }`, `POST` returns 429 and `generateSmallCapResearchReportMock` is not called.

- `__tests__/askedgar-tldr-route.test.ts` — extend the `@/lib/server-db-utils` mock to also export `dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 })`; add `vi.mock('@/lib/db', ...)` with a hoisted `getDbMock` returning a truthy object by default; add `vi.mock('@/lib/rate-limit', ...)` with `checkRateLimitMock` defaulting to not-limited and the real `rateLimitResponse`. Add two tests: (a) when rate limited, `POST` returns 429 and `getCachedResearchTldrMock` is not called; (b) when `getDbMock` returns `null`, `POST` returns 503 `{ error: 'Database not configured' }` and `getCachedResearchTldrMock` is not called.

**Deleted files:** none.

### Acceptance Criteria

- [x] `rate_limits` table exists in `lib/db/schema.ts` exactly as specified, and `npm run db:generate` produced `drizzle/0043_fat_timeslip.sql` creating it.
- [x] `lib/rate-limit.ts` exports `RATE_LIMITS`, `RateLimitEndpoint`, `RateLimitResult`, `checkRateLimit`, and `rateLimitResponse` matching the contract above.
- [x] `POST /api/research-report` returns 429 with the standard headers once a user exceeds 20 requests in the current UTC hour, without invoking the LLM generation path.
- [x] `POST /api/askedgar/tldr` returns 429 with the standard headers once a user exceeds 30 requests in the current UTC hour, without calling `getCachedResearchTldr`.
- [x] 401 (unauth) and 400 (invalid JSON / bad ticker) responses on both routes do not consume quota (the check runs after auth + validation).
- [x] `__tests__/rate-limit.test.ts` covers: under limit (not limited, correct `remaining`), exactly at limit (`count === limit` → not limited, `remaining === 0`), over limit (`count > limit` → limited, `remaining === 0`, `retryAfterSeconds >= 1`), and `rateLimitResponse` (status 429 + all four headers). Use a fixed `now` so `windowStart`/id are deterministic.
- [x] `POST /api/askedgar/tldr` returns 503 (not 500) when `getDb()` is null, without calling `getCachedResearchTldr`.
- [x] Both route tests pass with the new 429-path test added and all existing tests still green.

### Validation

Run before marking the sprint COMPLETE:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run db:generate` — confirm exactly one new `drizzle/0043_*.sql` is produced and it only creates `rate_limits` (no unrelated diffs). Commit it.
- Apply with `npm run db:migrate` against the database (never `npm run db:push`). If Codex has no `DATABASE_URL`, leave this for the user and note it in the completion report.
- Manual smoke (user, after deploy): hit one endpoint past its cap and confirm a 429 with `Retry-After` + `X-RateLimit-*` headers; confirm normal use under the cap is unaffected.

### Completion Evidence

- `npm run db:generate` produced exactly one new migration: `drizzle/0043_fat_timeslip.sql`, containing only `rate_limits` table creation, FK, and index.
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed: 95 files, 688 tests.
- `npm run db:migrate` passed and applied migrations successfully.
- `npm run typecheck:services` skipped because no `services/` files changed.
- Manual post-deploy smoke remains pending user verification.

---

## Recently Completed

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
