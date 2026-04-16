# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-16
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived on `2026-04-16` to keep this file focused. Agent Hardening #1 shipped in commit `7118598` and ancestors; Agent Hardening #2 (trust boundary in prompt assembly) shipped in commit `2a856f1` and was validated on `2026-04-16`. See git history for their implementation specs.

## Current State

**Active spec:** Agent Hardening #3 — completed locally, awaiting prod verification (see below).

Agent Hardening #1 (service chat GET authorization) and #2 (trust boundary in prompt assembly) are both shipped and archived from this file. Item #3 is the next handoff on the Agent Hardening backlog from `FUTURE-PLANS.md`; item #4 (approval gates + spend enforcement) follows.

## Validation Snapshot

Most recent validation (`2026-04-16`, local completion of Agent Hardening #3):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`48` files, `378` tests)

## Session Maintenance Checklist

When a spec in this file reaches COMPLETED status and has been verified in prod, remove it and reference the implementing commit in the top banner. Keep this file focused on the next active execution spec.

---

## Agent Hardening #3 — Memory / Retention TTL-on-Read

> Generated: 2026-04-16 | Agent: nexus-architect
> Status: COMPLETED (awaiting prod verification)
> Validation: `npm run lint`, `npx tsc --noEmit`, `npm test`

### Objective

This spec enforces retention and expiry across the three durable agent tables that accumulate content without bounds. `agent_memory_v2` already has an `expiresAt` column but `getMemory()` never filters on it; this spec adds a DB-side TTL filter and a default-TTL map so newly upserted memories expire automatically by category. `agent_conversations` has no date window on reads, enabling cross-session context injection replay; this spec adds a 30-day rolling window and an optional `sessionId` filter. `agent_request_log` has no cleanup; a new daily cron hard-deletes rows older than 90 days.

### Out of Scope

Do NOT implement any of the following. If you encounter them while reading the code, skip them:

- Adding `expiresAt` to `agent_conversations` schema
- Migrating existing `expiresAt: null` rows in `agent_memory_v2` to new defaults
- Soft-delete / `deleted_at` column pattern
- Per-user or per-tenant retention policies
- Memory review UI
- PII-specific handling
- Changes to `agent_reports`, `agent_jobs`, or `agent_scheduled_runs` retention

---

### Current State

#### `lib/agents/memory.ts` (57 lines)

`getMemory()` (lines 7–21): builds a `where` condition from `userId`, `agentId`, and optional `category`. No `expiresAt` filter — expired memories are returned to callers.

`upsertMemory()` (lines 23–56): accepts `row: Omit<AgentMemoryRow, 'id' | 'createdAt' | 'updatedAt'>` and writes `row.expiresAt` verbatim. No default TTL logic.

Current imports (line 1): `and`, `eq` from `drizzle-orm`.

#### `lib/agents/context.ts` (102 lines)

`buildContext(db, userId, agentId)` (lines 62–101): fires four parallel queries. The conversation query (lines 74–78) filters only on `userId` and `agentId` with no date window and no sessionId filter — returns up to 20 turns from any session at any point in history.

Current imports (line 1): `and`, `desc`, `eq` from `drizzle-orm`.

#### `lib/agents/types.ts`

`MemoryCategory` (lines 155–166): 11 values — `fact`, `thesis`, `watchlist`, `scan_param`, `performance`, `trade_insight`, `user_preference`, `strategy_note`, `macro_fact`, `pattern`, `sentiment`.

`AgentMemoryRow` (lines 329–342): fields include `expiresAt: Date | null`.

`AgentContext` (lines 344–349): `recentTrades`, `macroSummary`, `memory`, `conversationHistory`.

#### `lib/db/schema.ts`

`agentConversations` (lines 271–284): has `sessionId text NOT NULL` column. No `expiresAt`.

`agentRequestLog` (lines 286–306): has `createdAt` timestamp. No retention mechanism.

`agentMemoryV2` (lines 308–324): has `expiresAt timestamp with time zone` (nullable). No default expression, never filtered on read.

#### Blueprint callers

- `lib/agents/blueprints/small-cap-research.ts` `save-research` step (lines 825–841): calls `upsertMemory` with `category: 'thesis'` and explicit `expiresAt: new Date(Date.now() + (14 * 24 * 60 * 60 * 1000))`. Does NOT call `buildContext`.
- `lib/agents/blueprints/swing-trader-research.ts` `save-research` step (lines 893–909): calls `upsertMemory` with `category: 'thesis'` and explicit `expiresAt: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000))`. Does NOT call `buildContext`.
- `lib/agents/blueprints/orchestrator-chat.ts`: does NOT call `buildContext` or `upsertMemory` directly.

#### `buildContext` callers (full grep)

| Location | Line | Notes |
|---|---|---|
| `lib/agents/context.ts` | 62 | definition |
| `lib/agents/blueprint-runner.ts` | 365 | only production caller |
| `__tests__/agent-context.test.ts` | 54, 113, 158 | test calls only |

#### `lib/agents/blueprint-runner.ts` line 365

```typescript
const context = await buildContext(db, job.userId, job.agentId);
```

`job.input` is typed `unknown`. For chat jobs, the raw value contains `session_id?: string` (the `chatInputSchema` field from `orchestrator-chat.ts` line 18). For research jobs, no `session_id` is present.

#### `lib/server-db-utils.ts`

- `requireCronSecret(request: Request): Response | null` (lines 117–130): returns a Response on auth failure, `null` on success.
- `dbUnavailable(): Response` (lines 113–115): returns `{ error: 'Database not configured' }` with status 503.
- `logRouteError` is in `lib/api-route-utils.ts` (line 31), not in this file.

#### `vercel.json`

One existing cron: `{ "path": "/api/discord/cron/sync", "schedule": "0 10 * * 1-5" }`.

#### Cron route template

`app/api/discord/cron/sync/route.ts`: uses `requireCronSecret`, `dbUnavailable`, `logRouteError`, `export const dynamic = 'force-dynamic'`, `export const maxDuration = 60`, `export const runtime = 'nodejs'`. New route follows this structure but uses `getAgentDb` from `@/lib/agents/db` instead of `getDb`.

#### Test files

- `__tests__/agent-memory.test.ts` (125 lines): 2 existing tests. `createDb` mock's `where` is `vi.fn(async () => queue.shift() ?? [])` — does not record the WHERE argument.
- `__tests__/agent-context.test.ts` (177 lines): 3 existing tests. `createDb` mock's `where` is `vi.fn(() => ({ orderBy, limit }))` — does not record the WHERE argument.

---

### Required Changes

---

#### Change 1 — Add TTL filter and default TTL map to `lib/agents/memory.ts`

**File:** `/home/jared/Nexus-Terminal/lib/agents/memory.ts`
**Action:** MODIFY

**Step 1.1** — Update import on line 1. Add `gt`, `isNull`, `or`:

```typescript
// BEFORE (line 1):
import { and, eq } from 'drizzle-orm';

// AFTER:
import { and, eq, gt, isNull, or } from 'drizzle-orm';
```

**Step 1.2** — Insert `DEFAULT_MEMORY_TTL_DAYS` constant after the import block (after line 6, before `getMemory`). Cover all 11 `MemoryCategory` values. Categories not given a TTL in the spec default to `null`:

```typescript
// Default TTL in days per memory category.
// null = permanent (no automatic expiry).
// thesis, scan_param, watchlist have time-bounded relevance.
// All other categories default to null — update here if policy changes.
export const DEFAULT_MEMORY_TTL_DAYS: Record<MemoryCategory, number | null> = {
  thesis: 14,
  scan_param: 30,
  watchlist: 30,
  strategy_note: null,
  fact: null,
  performance: null,
  trade_insight: null,
  user_preference: null,
  macro_fact: null,
  pattern: null,
  sentiment: null,
};
```

**Step 1.3** — Modify `getMemory()` (lines 13–20) to add DB-side TTL filter. Do NOT hydrate and filter in JS.

```typescript
// BEFORE (lines 13–20):
  const baseCondition = and(eq(agentMemoryV2.userId, userId), eq(agentMemoryV2.agentId, agentId));
  const condition = category ? and(baseCondition, eq(agentMemoryV2.category, category)) : baseCondition;

  const rows = await db.select()
    .from(agentMemoryV2)
    .where(condition);

// AFTER:
  // TTL filter: expiresAt IS NULL (permanent) OR expiresAt > now() (still active).
  // IMPORTANT: lt(expiresAt, now) alone would silently exclude all NULL rows because
  // SQL NULL comparisons return UNKNOWN (not TRUE). The or(isNull, gt) form is required.
  const ttlCondition = or(isNull(agentMemoryV2.expiresAt), gt(agentMemoryV2.expiresAt, new Date()));
  const baseCondition = and(
    eq(agentMemoryV2.userId, userId),
    eq(agentMemoryV2.agentId, agentId),
    ttlCondition,
  );
  const condition = category ? and(baseCondition, eq(agentMemoryV2.category, category)) : baseCondition;

  const rows = await db.select()
    .from(agentMemoryV2)
    .where(condition);
```

**Step 1.4** — Change `upsertMemory` signature and add default TTL resolution logic.

```typescript
// BEFORE (lines 23–25):
export async function upsertMemory(
  db: AgentDb,
  row: Omit<AgentMemoryRow, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<void> {

// AFTER:
export async function upsertMemory(
  db: AgentDb,
  row: Omit<AgentMemoryRow, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'> & { expiresAt?: Date | null },
): Promise<void> {
```

Insert the following block immediately after the opening `{` of `upsertMemory`, before the `await db.insert(...)` call:

```typescript
  // Resolve expiresAt:
  //   undefined → apply category default from DEFAULT_MEMORY_TTL_DAYS
  //   null      → permanent (caller explicitly requested no expiry)
  //   Date      → use as-is (caller explicitly set expiry)
  let resolvedExpiresAt: Date | null;
  if (row.expiresAt !== undefined) {
    resolvedExpiresAt = row.expiresAt;
  } else {
    const ttlDays = DEFAULT_MEMORY_TTL_DAYS[row.category];
    resolvedExpiresAt = ttlDays !== null
      ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      : null;
  }
```

Replace both occurrences of `expiresAt: row.expiresAt` in the `values({...})` and `set: {...}` blocks with `expiresAt: resolvedExpiresAt`.

Acceptance criteria:
- [ ] Import includes `gt`, `isNull`, `or`
- [ ] `DEFAULT_MEMORY_TTL_DAYS` is exported, covers all 11 `MemoryCategory` values
- [ ] `getMemory()` WHERE clause includes `or(isNull(expiresAt), gt(expiresAt, new Date()))`
- [ ] `upsertMemory()` input type has `expiresAt?: Date | null` (optional)
- [ ] Caller passes `expiresAt: null` → stored as `null`
- [ ] Caller passes explicit `Date` → stored unchanged
- [ ] Caller omits `expiresAt` → computed from `DEFAULT_MEMORY_TTL_DAYS[category]`
- [ ] `npx tsc --noEmit` passes

---

#### Change 2 — Add `sessionId` param and 30-day window to `lib/agents/context.ts`

**File:** `/home/jared/Nexus-Terminal/lib/agents/context.ts`
**Action:** MODIFY

**Step 2.1** — Update import on line 1. Add `gt`:

```typescript
// BEFORE:
import { and, desc, eq } from 'drizzle-orm';

// AFTER:
import { and, desc, eq, gt } from 'drizzle-orm';
```

**Step 2.2** — Add optional `sessionId?: string` as the fourth parameter of `buildContext` (lines 62–66):

```typescript
// BEFORE:
export async function buildContext(
  db: AgentDb,
  userId: string,
  agentId: AgentId,
): Promise<AgentContext> {

// AFTER:
export async function buildContext(
  db: AgentDb,
  userId: string,
  agentId: AgentId,
  sessionId?: string,
): Promise<AgentContext> {
```

**Step 2.3** — Replace the conversation query (lines 74–78) with the windowed + session-filtered version:

```typescript
// BEFORE (lines 74–78):
    db.select()
      .from(agentConversations)
      .where(and(eq(agentConversations.userId, userId), eq(agentConversations.agentId, agentId)))
      .orderBy(desc(agentConversations.createdAt))
      .limit(20),

// AFTER:
    db.select()
      .from(agentConversations)
      .where(and(
        eq(agentConversations.userId, userId),
        eq(agentConversations.agentId, agentId),
        // 30-day rolling window prevents unbounded cross-session history injection.
        gt(agentConversations.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        // When sessionId is provided, narrow to that session only.
        ...(sessionId !== undefined ? [eq(agentConversations.sessionId, sessionId)] : []),
      ))
      .orderBy(desc(agentConversations.createdAt))
      .limit(20),
```

Acceptance criteria:
- [ ] `gt` added to import
- [ ] `buildContext` signature has optional `sessionId?: string` as 4th param
- [ ] Conversation query always includes `gt(createdAt, now - 30d)` filter
- [ ] `sessionId` provided → `eq(sessionId, sessionId)` also in the `and()` chain
- [ ] `sessionId` omitted → only the 30d filter applies
- [ ] All existing 3-arg callers still type-check
- [ ] `npx tsc --noEmit` passes

---

#### Change 3 — Thread `sessionId` through `lib/agents/blueprint-runner.ts`

**File:** `/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts`
**Action:** MODIFY

**Step 3.1** — Replace line 365 in `runBlueprint`:

```typescript
// BEFORE (line 365):
  const context = await buildContext(db, job.userId, job.agentId);

// AFTER:
  // Extract session_id from job.input for chat jobs. For research and other job types,
  // session_id is absent, so jobSessionId will be undefined and buildContext uses
  // the 30-day rolling window only.
  const rawJobInput = job.input as Record<string, unknown> | null | undefined;
  const jobSessionId = typeof rawJobInput?.session_id === 'string'
    ? rawJobInput.session_id
    : undefined;
  const context = await buildContext(db, job.userId, job.agentId, jobSessionId);
```

Acceptance criteria:
- [ ] Chat jobs pass `session_id` from `job.input` to `buildContext`
- [ ] Non-chat jobs pass `undefined` — 30d window applies
- [ ] No TypeScript errors (`job.input` is `unknown`, cast is guarded by `typeof` check)
- [ ] `npx tsc --noEmit` passes

---

#### Change 4 — Verify no changes needed in blueprint callers for `upsertMemory`

**Files:** `lib/agents/blueprints/small-cap-research.ts`, `lib/agents/blueprints/swing-trader-research.ts`
**Action:** NO CHANGE (verification only)

Both files pass `expiresAt: new Date(...)` as an explicit `Date`. Under the new type `expiresAt?: Date | null`, a `Date` is assignable to `Date | null`, so both callers remain type-correct. Do not modify these files. Verify by running `npx tsc --noEmit` after Change 1.

Note: swing-trader uses 7d for `thesis` and small-cap uses 14d. Both are explicit Dates, so the default (`DEFAULT_MEMORY_TTL_DAYS['thesis'] = 14`) does not apply. This intentional divergence is preserved unchanged.

Acceptance criteria:
- [ ] `npx tsc --noEmit` passes with no errors in either blueprint file

---

#### Change 5 — Create `app/api/cron/agent-retention/route.ts`

**File:** `/home/jared/Nexus-Terminal/app/api/cron/agent-retention/route.ts`
**Action:** CREATE

Create the directory `app/api/cron/agent-retention/` and the file `route.ts` with the following content exactly:

```typescript
import { lt } from 'drizzle-orm';
import { logRouteError } from '@/lib/api-route-utils';
import { dbUnavailable, requireCronSecret } from '@/lib/server-db-utils';
import { getAgentDb } from '@/lib/agents/db';
import { agentMemoryV2, agentRequestLog } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * GET /api/cron/agent-retention
 *
 * Vercel cron job — hard-deletes expired agent memory rows and
 * request-log rows older than 90 days. Authenticated via CRON_SECRET.
 *
 * SQL NULL note: lt(expiresAt, now) uses SQL < which naturally excludes NULL rows
 * (NULL comparisons return UNKNOWN in SQL, not TRUE). Permanent memories
 * (expiresAt IS NULL) are therefore never deleted by this cron. This is correct.
 */
export async function GET(request: Request) {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  const db = getAgentDb();
  if (!db) {
    return dbUnavailable();
  }

  let memoryDeleted = 0;
  let requestLogDeleted = 0;

  try {
    const deleted = await db
      .delete(agentMemoryV2)
      .where(lt(agentMemoryV2.expiresAt, new Date()))
      .returning({ id: agentMemoryV2.id });
    memoryDeleted = deleted.length;
  } catch (error) {
    logRouteError('agent-retention:memory', error);
  }

  try {
    const deleted = await db
      .delete(agentRequestLog)
      .where(lt(agentRequestLog.createdAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)))
      .returning({ id: agentRequestLog.id });
    requestLogDeleted = deleted.length;
  } catch (error) {
    logRouteError('agent-retention:request-log', error);
  }

  return Response.json({ memoryDeleted, requestLogDeleted });
}
```

Acceptance criteria:
- [ ] File exists at `app/api/cron/agent-retention/route.ts`
- [ ] Exports `GET`, `dynamic`, `maxDuration`, `runtime`
- [ ] Returns 401 on bad/missing secret (delegated to `requireCronSecret`)
- [ ] Returns 503 when `getAgentDb()` returns null
- [ ] Returns `{ memoryDeleted: number, requestLogDeleted: number }` on success
- [ ] Memory delete failure does not block request-log delete
- [ ] `npx tsc --noEmit` passes

---

#### Change 6 — Add new cron entry to `vercel.json`

**File:** `/home/jared/Nexus-Terminal/vercel.json`
**Action:** MODIFY

```json
// BEFORE:
{
  "crons": [
    {
      "path": "/api/discord/cron/sync",
      "schedule": "0 10 * * 1-5"
    }
  ]
}

// AFTER:
{
  "crons": [
    {
      "path": "/api/discord/cron/sync",
      "schedule": "0 10 * * 1-5"
    },
    {
      "path": "/api/cron/agent-retention",
      "schedule": "0 8 * * *"
    }
  ]
}
```

`"0 8 * * *"` = 08:00 UTC daily (off-peak for US markets).

Acceptance criteria:
- [ ] `vercel.json` is valid JSON with two entries in `crons`
- [ ] New entry path is `/api/cron/agent-retention`
- [ ] New entry schedule is `"0 8 * * *"`

---

#### Change 7 — Extend `__tests__/agent-memory.test.ts`

**File:** `/home/jared/Nexus-Terminal/__tests__/agent-memory.test.ts`
**Action:** MODIFY

**Step 7.1** — Update import on line 1 to add `afterEach`, `beforeEach`:

```typescript
// BEFORE:
import { describe, expect, it, vi } from 'vitest';

// AFTER:
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

**Step 7.2** — Update import on line 4 to add `DEFAULT_MEMORY_TTL_DAYS`:

```typescript
// BEFORE:
import { getMemory, upsertMemory } from '@/lib/agents/memory';

// AFTER:
import { DEFAULT_MEMORY_TTL_DAYS, getMemory, upsertMemory } from '@/lib/agents/memory';
```

**Step 7.3** — Replace the `createDb` function (lines 6–44) with an upgraded version that records the argument passed to `where` in `_state.whereArgs`. The `where` mock must still return a Promise so the existing tests work:

```typescript
function createDb(tableRows: Map<unknown, unknown[][]> = new Map()) {
  const insertedValues: unknown[] = [];
  const conflictCalls: unknown[] = [];
  const whereArgs: unknown[] = [];

  const select = vi.fn(() => ({
    from(table: unknown) {
      const queue = tableRows.get(table) ?? [];
      tableRows.set(table, queue);

      return {
        where: vi.fn((condition: unknown) => {
          whereArgs.push(condition);
          return Promise.resolve(queue.shift() ?? []);
        }),
      };
    },
  }));

  const conflict = vi.fn(async (args: unknown) => {
    conflictCalls.push(args);
  });

  const values = vi.fn((value: unknown) => {
    insertedValues.push(value);
    return {
      onConflictDoUpdate: conflict,
    };
  });

  const insert = vi.fn(() => ({
    values,
  }));

  return {
    insert,
    select,
    _state: {
      insertedValues,
      conflictCalls,
      whereArgs,
    },
  };
}
```

**Step 7.4** — Add four new tests inside the existing `describe('agent memory helpers')` block, after the second existing test (`it('upserts memory rows...')`):

```typescript
  it('getMemory() passes a TTL condition to the DB where clause', async () => {
    const tableRows = new Map<unknown, unknown[][]>();
    tableRows.set(agentMemoryV2, [[]]);
    const db = createDb(tableRows);

    await getMemory(db as never, 'user-1', 'orchestrator');

    // The where clause must have been called once with a defined (non-null) condition.
    // Drizzle constructs an SQL node object — we verify it was passed, not its internals.
    expect(db._state.whereArgs).toHaveLength(1);
    expect(db._state.whereArgs[0]).toBeDefined();
  });

  it('upsertMemory() applies category default TTL when expiresAt is omitted', async () => {
    const fakeNow = new Date('2026-04-16T08:00:00.000Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const db = createDb();

    await upsertMemory(db as never, {
      userId: 'user-1',
      agentId: 'orchestrator',
      category: 'thesis',
      key: 'AAPL',
      value: 'bullish thesis',
      valueJson: null,
      source: null,
      confidence: null,
      // expiresAt intentionally omitted — should use DEFAULT_MEMORY_TTL_DAYS['thesis']
    });

    const ttlDays = DEFAULT_MEMORY_TTL_DAYS['thesis'];
    expect(ttlDays).not.toBeNull();
    const expectedExpiry = new Date(fakeNow + (ttlDays as number) * 24 * 60 * 60 * 1000);

    expect(db._state.insertedValues[0]).toMatchObject({ expiresAt: expectedExpiry });

    vi.useRealTimers();
  });

  it('upsertMemory() respects explicit null — does not override with default TTL', async () => {
    const db = createDb();

    await upsertMemory(db as never, {
      userId: 'user-1',
      agentId: 'orchestrator',
      category: 'thesis',
      key: 'TSLA',
      value: 'permanent memory',
      valueJson: null,
      source: null,
      confidence: null,
      expiresAt: null, // explicit null = permanent
    });

    expect(db._state.insertedValues[0]).toMatchObject({ expiresAt: null });
  });

  it('upsertMemory() respects explicit Date — does not override with default TTL', async () => {
    const customExpiry = new Date('2027-01-01T00:00:00.000Z');
    const db = createDb();

    await upsertMemory(db as never, {
      userId: 'user-1',
      agentId: 'orchestrator',
      category: 'thesis',
      key: 'MSFT',
      value: 'custom expiry',
      valueJson: null,
      source: null,
      confidence: null,
      expiresAt: customExpiry,
    });

    expect(db._state.insertedValues[0]).toMatchObject({ expiresAt: customExpiry });
  });
```

Acceptance criteria:
- [ ] 4 new tests added inside existing `describe` block
- [ ] `vi.useFakeTimers` paired with `vi.useRealTimers` in TTL default test
- [ ] `createDb` upgraded — `where` still returns a Promise (backward compatible)
- [ ] All 2 existing tests still pass

---

#### Change 8 — Extend `__tests__/agent-context.test.ts`

**File:** `/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts`
**Action:** MODIFY

**Step 8.1** — Replace the `createDb` function (lines 17–43) with an upgraded version that captures the `where` argument per table in `_state.whereArgsByTable`:

```typescript
function createDb(tableRows: Map<unknown, unknown[][]> = new Map()) {
  const whereArgsByTable = new Map<unknown, unknown[]>();

  const select = vi.fn(() => ({
    from(table: unknown) {
      const queue = tableRows.get(table) ?? [];
      tableRows.set(table, queue);

      return {
        where: vi.fn((condition: unknown) => {
          const existing = whereArgsByTable.get(table) ?? [];
          existing.push(condition);
          whereArgsByTable.set(table, existing);

          return {
            orderBy: vi.fn(() => ({
              limit: async (count: number) => {
                const rows = queue.shift() ?? [];
                return rows.slice(0, count);
              },
            })),
            limit: async (count: number) => {
              const rows = queue.shift() ?? [];
              return rows.slice(0, count);
            },
          };
        }),
      };
    },
  }));

  return {
    select,
    _state: {
      whereArgsByTable,
    },
  };
}
```

**Step 8.2** — Verify the three existing tests still pass. They call `createDb(rows)` and then `buildContext(db as never, ...)`. The upgraded mock still returns the same `{ orderBy, limit }` shape from `where`, so no changes to existing test bodies are needed.

**Step 8.3** — Add two new tests after the third existing test, still inside `describe('agent context helper')`:

```typescript
  it('buildContext() with sessionId records a where condition on agentConversations', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(trades, [[]]);
    rows.set(agentConversations, [[]]);
    rows.set(agentReports, [[]]);
    const db = createDb(rows);
    getMemoryMock.mockResolvedValueOnce([]);

    await buildContext(db as never, 'user-1', 'orchestrator', 'session-abc');

    const convWhereArgs = db._state.whereArgsByTable.get(agentConversations) ?? [];
    expect(convWhereArgs).toHaveLength(1);
    // A Drizzle SQL node was constructed and passed (truthy).
    // The exact clause shape is enforced by TypeScript compilation.
    expect(convWhereArgs[0]).toBeDefined();
  });

  it('buildContext() without sessionId still records a where condition on agentConversations', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(trades, [[]]);
    rows.set(agentConversations, [[]]);
    rows.set(agentReports, [[]]);
    const db = createDb(rows);
    getMemoryMock.mockResolvedValueOnce([]);

    await buildContext(db as never, 'user-1', 'orchestrator');

    const convWhereArgs = db._state.whereArgsByTable.get(agentConversations) ?? [];
    expect(convWhereArgs).toHaveLength(1);
    expect(convWhereArgs[0]).toBeDefined();
  });
```

Acceptance criteria:
- [ ] 2 new tests added inside existing `describe` block
- [ ] `createDb` exposes `_state.whereArgsByTable`
- [ ] All 3 existing tests still pass

---

#### Change 9 — Create `__tests__/agent-retention-cron.test.ts`

**File:** `/home/jared/Nexus-Terminal/__tests__/agent-retention-cron.test.ts`
**Action:** CREATE

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireCronSecretMock,
  getAgentDbMock,
} = vi.hoisted(() => ({
  requireCronSecretMock: vi.fn(),
  getAgentDbMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireCronSecret: requireCronSecretMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

import { GET } from '@/app/api/cron/agent-retention/route';

// Creates a mock DB whose delete().where().returning() resolves to the provided rows.
// deleteCallCount is used to distinguish first (memory) vs second (request-log) delete.
function createRetentionDb(
  memoryRows: { id: string }[],
  requestLogRows: { id: string }[],
) {
  let deleteCallCount = 0;
  return {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => {
          deleteCallCount += 1;
          return deleteCallCount === 1 ? memoryRows : requestLogRows;
        }),
      })),
    })),
  };
}

describe('agent-retention cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCronSecretMock.mockReturnValue(null); // null = auth passed
  });

  it('returns 401 when cron secret is missing or wrong', async () => {
    requireCronSecretMock.mockReturnValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention'),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 when database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns memoryDeleted and requestLogDeleted counts', async () => {
    const db = createRetentionDb(
      [{ id: 'mem-1' }, { id: 'mem-2' }],
      [{ id: 'log-1' }],
    );
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 2, requestLogDeleted: 1 });
  });

  it('returns zero counts when both tables are empty', async () => {
    const db = createRetentionDb([], []);
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 0, requestLogDeleted: 0 });
  });

  it('continues to delete request-log rows even when memory delete throws', async () => {
    let callCount = 0;
    const db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            callCount += 1;
            if (callCount === 1) {
              throw new Error('memory delete failed');
            }
            return [{ id: 'log-1' }];
          }),
        })),
      })),
    };
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 0, requestLogDeleted: 1 });
  });

  it('continues to delete memory rows even when request-log delete throws', async () => {
    let callCount = 0;
    const db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            callCount += 1;
            if (callCount === 2) {
              throw new Error('request-log delete failed');
            }
            return [{ id: 'mem-1' }];
          }),
        })),
      })),
    };
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 1, requestLogDeleted: 0 });
  });
});
```

Acceptance criteria:
- [ ] File exists at `__tests__/agent-retention-cron.test.ts`
- [ ] 6 tests: 401, 503, success with counts, empty tables, memory-delete-fails, request-log-delete-fails
- [ ] All 6 tests pass

---

### Files Changed Summary

| File | Action | Est. Lines +/- | Risk |
|---|---|---|---|
| `lib/agents/memory.ts` | MODIFY | +40 | MEDIUM — affects all memory reads |
| `lib/agents/context.ts` | MODIFY | +12 | MEDIUM — affects all agent job context |
| `lib/agents/blueprint-runner.ts` | MODIFY | +7 | LOW — safe cast, no logic change for non-chat jobs |
| `app/api/cron/agent-retention/route.ts` | CREATE | +55 | LOW — new isolated file |
| `vercel.json` | MODIFY | +4 | LOW — additive JSON |
| `__tests__/agent-memory.test.ts` | MODIFY | +65 | LOW — tests only |
| `__tests__/agent-context.test.ts` | MODIFY | +45 | LOW — tests + `createDb` upgrade |
| `__tests__/agent-retention-cron.test.ts` | CREATE | +100 | LOW — tests only |
| `lib/agents/blueprints/small-cap-research.ts` | none | 0 | — |
| `lib/agents/blueprints/swing-trader-research.ts` | none | 0 | — |

---

### Acceptance Criteria (consolidated)

- [ ] `getMemory()` WHERE clause includes `or(isNull(expiresAt), gt(expiresAt, now))` — expired rows never returned
- [ ] `DEFAULT_MEMORY_TTL_DAYS` exported from `lib/agents/memory.ts`, covers all 11 `MemoryCategory` values
- [ ] `upsertMemory()` with `expiresAt` omitted → computes TTL from `DEFAULT_MEMORY_TTL_DAYS[category]`
- [ ] `upsertMemory()` with `expiresAt: null` → stores `null` (permanent)
- [ ] `upsertMemory()` with `expiresAt: <Date>` → stores that Date unchanged
- [ ] `buildContext()` conversation query always includes `gt(createdAt, now - 30d)` filter
- [ ] `buildContext()` with `sessionId` → conversation query also filters by `eq(sessionId, value)`
- [ ] `buildContext()` without `sessionId` → only 30d filter
- [ ] `blueprint-runner.ts` passes `session_id` from `job.input` for chat jobs; `undefined` otherwise
- [ ] `app/api/cron/agent-retention/route.ts` exports `GET`
- [ ] Cron: 401 on bad secret, 503 on DB unavailable, `{ memoryDeleted, requestLogDeleted }` on success
- [ ] Memory delete failure does not block request-log delete (and vice versa)
- [ ] `vercel.json` has two cron entries; new one path = `/api/cron/agent-retention`, schedule = `"0 8 * * *"`
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes — expect ~366 + 12 = ~378 tests total

---

### Security Considerations

**Prevented by this spec:**
- Cross-session context injection: `sessionId` filter prevents messages from unrelated sessions appearing in context.
- Unbounded memory accumulation: expired rows are filtered on read and purged nightly.
- Unbounded audit log growth: request log rows older than 90 days are hard-deleted.

**Not addressed:**
- PII in `agent_conversations` content (no per-user purge).
- `CRON_SECRET` must be set in Vercel env before the cron activates — if not set, route returns 503 instead of deleting.
- No soft-delete audit trail for what was deleted by the cron.

---

### Rollback Plan

1. To stop the cron: remove the `agent-retention` entry from `vercel.json` and redeploy.
2. To revert the `getMemory` TTL filter: revert `lib/agents/memory.ts`. No data was deleted — only read behavior changes.
3. To revert the conversation window: revert `lib/agents/context.ts`. No data was deleted — only query behavior changes.
4. No schema migrations were made — all rollbacks are source-file-only.

---

### Order of Operations

1. Modify `lib/agents/memory.ts` (Change 1). Run `npx tsc --noEmit` — must pass.
2. Modify `lib/agents/context.ts` (Change 2). Run `npx tsc --noEmit` — must pass.
3. Modify `lib/agents/blueprint-runner.ts` (Change 3). Run `npx tsc --noEmit` — must pass.
4. Confirm no changes needed in `small-cap-research.ts` and `swing-trader-research.ts` (Change 4). Run `npx tsc --noEmit` — must pass.
5. Create `app/api/cron/agent-retention/route.ts` (Change 5).
6. Modify `vercel.json` (Change 6).
7. Modify `__tests__/agent-memory.test.ts` (Change 7).
8. Modify `__tests__/agent-context.test.ts` (Change 8).
9. Create `__tests__/agent-retention-cron.test.ts` (Change 9).
10. Run `npm run lint && npx tsc --noEmit && npm test`. All must pass.

---

### Verification Steps

1. `npm run lint` — zero errors.
2. `npx tsc --noEmit` — zero type errors.
3. `npm test` — expect approximately 378 tests passing (~12 new).
4. Manual: `curl -X GET https://<your-domain>/api/cron/agent-retention -H "Authorization: Bearer <CRON_SECRET>"` — expect `{ "memoryDeleted": <n>, "requestLogDeleted": <n> }` with status 200.
5. Manual auth check: `curl -X GET https://<your-domain>/api/cron/agent-retention` (no header) — expect status 401.

---

### Complexity Estimate

**MEDIUM** — 3 source files modified (memory, context, blueprint-runner), 1 new route file, vercel.json updated, and 3 test files changed/created. The riskiest change is the `buildContext` conversation window affecting every agent job. No schema migrations, so rollback is purely source-file-based.
