# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4, SSE Jarvis Streaming, Discord Research Schwab Validation, Research Tab Full Redesign, Direct Relay WebSocket, Macro Summary Upgrade, Charts Tab Drawing Tools, Schwab Relay Auth) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

---

## PRIORITY: Fix ensureUser() FK Violation (All Routes Returning 500)

> Generated: 2026-03-25 | Blocking: every authenticated route is broken

### Problem

Commit `f34dbd4` changed `ensureUser()` to UPDATE `users.id` (primary key) when the session ID doesn't match the DB. All FKs use `ON UPDATE no action`, so this throws a constraint violation → 500 on every authenticated route.

The original bug it fixed was real: `/api/schwab/status` returned `linked: false` because it queried `schwab_links` with the raw session ID instead of the DB's canonical user ID.

### Fix: 3 files, ~30 lines changed, no migrations

---

### Step 1: Revert `ensureUser()` — `lib/server-db-utils.ts`

#### 1a: Fix email-match branch (lines 52-65)

Replace lines 52-65 with:

```typescript
  const userByEmail = existingUsers.find((row) => row.email === user.email);
  if (userByEmail) {
    // Remap session ID to the DB's canonical ID. This mutates the passed-in
    // user object so callers that use authState.user.id get the right ID.
    user.id = userByEmail.id;
    if (userByEmail.name !== user.name || userByEmail.picture !== user.picture) {
      await db.update(users)
        .set({ name: user.name, picture: user.picture })
        .where(eq(users.id, user.id));
    }
    return {
      id: userByEmail.id,
      email: userByEmail.email,
      name: user.name,
      picture: user.picture,
    };
  }
```

**What changed:** Removed `id: user.id` from `.set()` (no PK update). Added `user.id = userByEmail.id` to mutate the session object to the DB's canonical ID. All 20+ callers that use `authState.user.id` after calling `ensureUser()` automatically get the correct ID.

#### 1b: Fix race-condition catch block (lines 82-94)

Replace lines 82-94 with:

```typescript
      if (!canonicalUser) {
        throw error;
      }

      user.id = canonicalUser.id;
      if (canonicalUser.name !== user.name || canonicalUser.picture !== user.picture) {
        await db.update(users)
          .set({ name: user.name, picture: user.picture })
          .where(eq(users.id, canonicalUser.id));
      }
      return {
        id: canonicalUser.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      };
```

**What changed:** Same pattern — mutate `user.id` to canonical, update name/picture only, never touch PK.

---

### Step 2: Add `ensureUser()` to `/api/schwab/status` — `app/api/schwab/status/route.ts`

This route only calls `requireUser()`, not `ensureUser()`. When session ID differs from DB ID, it queries `schwab_links` with the wrong ID → returns `linked: false`. This was the original bug.

#### 2a: Update import (line 5)

Change:
```typescript
import { dbUnavailable, requireUser } from '@/lib/server-db-utils';
```
to:
```typescript
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
```

#### 2b: Add `ensureUser()` in GET handler

After line 13 (`if (!db) return dbUnavailable();`), add:
```typescript
    await ensureUser(db, authState.user);
```

#### 2c: Add `ensureUser()` in DELETE handler

After line 64 (`if (!db) return dbUnavailable();`), add:
```typescript
    await ensureUser(db, authState.user);
```

---

### Step 3: Update tests — `__tests__/server-db-utils.test.ts`

#### 3a: Fix "reuses matching email row" test (lines 165-188)

Replace the entire test with:

```typescript
  it('reuses matching email row and remaps session id to canonical', async () => {
    const db = createDb({
      selectRows: [
        [
          {
            id: 'canonical-user',
            email: 'user@example.com',
            name: 'Stored Name',
            picture: 'stored.png',
          },
        ],
      ],
    });

    const authUser = { id: 'nextauth-id', email: 'user@example.com', name: 'Stored Name', picture: 'stored.png' };

    const ensured = await ensureUser(db as any, authUser);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    // No update needed — name and picture haven't changed
    expect(db.update).not.toHaveBeenCalled();
    // Session ID was remapped to canonical DB ID
    expect(authUser.id).toBe('canonical-user');
    expect(ensured.id).toBe('canonical-user');
  });
```

#### 3b: Fix "falls back to canonical row" test assertion (line 160-162)

Change lines 160-162 from:
```typescript
    // New behavior: DB row ID is updated to match session ID (not the other way around)
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(ensured.id).toBe('nextauth-id');
```
to:
```typescript
    // Session ID was remapped to canonical DB ID (no PK update)
    expect(db.update).not.toHaveBeenCalled();
    expect(authUser.id).toBe('canonical-user');
    expect(ensured.id).toBe('canonical-user');
```

---

### Step 4: Validate

```bash
npm run lint && npx tsc --noEmit && npx vitest run __tests__/server-db-utils.test.ts
```

All must pass.

---

### Why This Works

The mutation approach (`user.id = canonicalId`) means all 20+ routes that pass `authState.user` to `ensureUser()` and then use `authState.user.id` for DB queries automatically get the canonical ID. No need to change any of those callers.

Adding `ensureUser()` to `/api/schwab/status` fixes the original Schwab bug: the status query now uses the canonical ID, matching what the callback saved.

| Scenario | Before (broken) | After (fixed) |
|----------|-----------------|---------------|
| Session ID matches DB ID | Works | Works |
| Session ID differs | FK violation → 500 | Remaps to canonical → works |
| Schwab status query | Wrong ID → `linked: false` | Canonical ID → correct |

---

## Codebase Simplification — Phases 3-4

> Generated: 2026-03-24 | Phases 1-2 complete, Phases 3-4 remain
> Phase 1 (dead code deletion) is done — ~700+ lines removed.
> Phase 2 (bug-risk duplication) is done — 0 lint/type errors, 207/207 tests passing.

### Phase 3: Consolidate Shared API Route Patterns

**3.1** Wire `dbUnavailable()` into 17 routes that inline it (helper exists in `server-db-utils.ts`)
**3.2** Extract `requireCronSecret()` — copy-pasted in 2 cron routes → move to `lib/server-db-utils.ts`
**3.3** Extract `rateLimitExceededResponse()` — same 429 block in 4 jarvis routes → add to `lib/jarvis/rate-limit.ts`
**3.4** Extract `buildTradeInsertValues()` — 20+ field insert duplicated in 2 trade routes (note: import omits `notes` from conflict update intentionally)
**3.5** Extract `saveDiscordReports()` — same insert loop in 3 discord routes → `lib/discord/`
**3.6** Move `INDEX_SYMBOLS`/`COMMODITY_SYMBOLS`/`EQUITY_SYMBOLS` to `lib/massive-market.ts` (duplicated in 2 market routes)
**3.7** Move `ScannerSortKey`/`ScannerSortDir` types to `lib/types.ts` (can't import from `'use client'` hook into server route)
**3.8** Export `buildQueryString` from `use-scanner.ts` (duplicated in `use-market-stream.ts`)
**3.9** Smaller cleanups:
- `normalizeTimestamp()` duplicated in 2 trade routes → `lib/time-utils.ts`
- `toNumberOrUndefined()` duplicated in 2 routes → `lib/api-route-utils.ts`
- `requireDiscordConfig()` env check in 3 discord routes (+ status code inconsistency 400 vs 503)
- AskEdgar routes skip `logRouteError`/`internalServerError` → use standard helpers
- `askedgar/tldr` skips `parseAndValidate` → add Zod schema
- `market-data/stream` missing top-level try/catch
- Ticker normalize + regex repeated → use `TICKER_REGEX` from askedgar, create `normalizeTicker()`

### Phase 4: Component Dedup (touch as needed)

**4.1** Extract `AskEdgarEndpointResponse` interface (copy-pasted in 3 components) + shared helpers (`formatNumber`, `formatMoney`, `getField`, `riskClass`) → `lib/askedgar-utils.ts`
**4.2** Extract `buildTradeMarkers()` (duplicated in `JournalTradeChart.tsx` + `TradeDetailSheet.tsx`) → `lib/trading-utils.ts`
**4.3** Move chart color constants + `FRAME_CONFIG` to `lib/chart-timeframes.ts` (duplicated across 3 chart components)
**4.4** Wrap PerformanceTab symbol distribution in `useMemo` (non-memoized reduce at lines 71-88)
**4.5** Lower priority: `ResearchChart` reimplements chart lifecycle, duplicate stat calcs, duplicate pagination, double `fetchResults` on mount in `use-scanner.ts`, `sortTrades` alias

### Deferred

- `lib/trade-migration.ts` — keep until all users confirmed migrated from localStorage
- `lib/storage.ts` — tied to trade-migration
- Discord import/sync routes — headless but functional
- Jarvis research/trade-analysis routes — redundant with chat but functional
- `hooks/trade-utils.ts` → `lib/trade-utils.ts` rename — low priority
- `buildResearchPrompt` in prompts.ts — now dead but harmless
