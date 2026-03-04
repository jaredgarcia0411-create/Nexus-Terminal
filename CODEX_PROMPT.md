# Nexus Terminal — Implementation Plan

## Overview

Nexus Terminal is a Next.js 15 trading journal app with Turso (LibSQL) cloud persistence, NextAuth v5 Google OAuth, and a dark theme built on shadcn/ui. The app is functional for core trade management but needs the following changes to be fully complete.

This document describes **4 workstreams** in priority order. Each section includes the exact files to create/modify, the behavior expected, and implementation constraints.

---

## 1. Custom Login Page (Gate the Entire App)

### Current Behavior
- The app renders the full dashboard immediately. An unauthenticated user sees everything but with a "Sign in with Google" button in the sidebar header.
- `lib/auth-config.ts` sets `pages: { signIn: '/' }`, meaning NextAuth redirects to the root page for sign-in — but there is no dedicated login UI.

### Required Changes

**Create `app/login/page.tsx`** — A dedicated full-screen login page:
- Centered card on a dark background (`#0A0A0B`)
- App logo/name "Nexus Terminal" with a tagline (e.g., "Professional Trading Journal")
- A single "Sign in with Google" button using `signIn('google')` from `next-auth/react`
- Styled with the existing emerald/dark theme — use shadcn `Button` component
- Animated entrance using `motion/react` (fade + slide up), consistent with the rest of the app
- No access to any app functionality from this page — login is the only action

**Modify `lib/auth-config.ts`**:
- Change `pages: { signIn: '/' }` to `pages: { signIn: '/login' }`
- This makes NextAuth redirect unauthenticated users to `/login` automatically

**Create `middleware.ts`** (project root):
- Use NextAuth's `auth` export to protect all routes
- Redirect unauthenticated users to `/login`
- Allow unauthenticated access to: `/login`, `/api/auth/*` (NextAuth routes)
- Use the `authorized` callback pattern from NextAuth v5:
```ts
export { auth as middleware } from '@/lib/auth-config';

export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
```
Note: This requires exporting `auth` from `lib/auth-config.ts` which is already done. The middleware approach may need adjustment — NextAuth v5 supports a `middleware` export or you can use the `authorized` callback in the auth config. Choose whichever approach works cleanly with the existing setup.

**Modify `app/page.tsx`**:
- Remove the inline Google sign-in button from the sidebar (the one that shows when `!session`)
- Remove the `handleSignIn` function — login is now handled by the `/login` page
- The page can now assume the user is always authenticated (middleware enforces this)
- Keep `handleSignOut` — the user menu in the sidebar should still allow signing out
- Remove any conditional rendering based on `!session` for the main content area

**Remove the notification bell icon**:
- In the sidebar icon group (around line 666-672 of `app/page.tsx`), remove the `<Bell>` icon button and its `onClick={() => toast('No new notifications')}` handler
- Remove `Bell` from the lucide-react import

### Acceptance Criteria
- Visiting any page while unauthenticated redirects to `/login`
- `/login` shows a clean, branded login page with Google sign-in
- After signing in, user is redirected to the dashboard (`/`)
- No app content is visible without authentication
- The bell icon is completely removed from the sidebar

---

## 2. Refactor `app/page.tsx` Into Smaller Components

### Current State
`app/page.tsx` is ~1100 lines containing all state management, event handlers, sidebar, toolbar, and tab content in a single `'use client'` component.

### Required Changes

**Extract a custom hook: `hooks/use-trades.ts`**:
- Move all trade-related state: `trades`, `globalTags`, `useLocalStorage`, `mounted`
- Move all trade handlers: `handleFileUpload`, `handleCreateManualTrade`, `handleDeleteSelected`, `handleApplyRisk`, `handleSaveNotes`, `handleAddTag`, `handleRemoveTag`, `handleDeleteGlobalTag`, `handleBulkAddTag`, `handleClearAllData`
- Move the `useEffect` that loads trades (local or remote) and handles migration
- Move `filteredTrades`, `hasActiveFilters`, `activeFilterCount`, `clearAllFilters`
- Move filter state: `startDate`, `endDate`, `filterPreset`, `selectedFilterTags`, `searchQuery`
- Export all state and handlers the components need

**Extract `components/trading/Sidebar.tsx`**:
- The left sidebar with navigation icons, user avatar, settings menu
- Props: `activeTab`, `setActiveTab`, `session`, `onSignOut`
- Include the `SettingsMenu` integration

**Extract `components/trading/Toolbar.tsx`**:
- The top bar with search, import button, new trade button, filter controls, bulk actions
- Props: all filter state/setters, selection state, import/delete/risk handlers

**Extract tab content components**:
- `components/trading/DashboardTab.tsx` — stats cards + recent trades table
- `components/trading/JournalTab.tsx` — full trade table with selection/bulk actions
- `components/trading/PerformanceTab.tsx` — charts wrapper with metric toggle
- `components/trading/FilterTab.tsx` — filter controls (date range, presets, tags)
- `components/trading/BacktestingTab.tsx` — (see workstream 3 below)

**Simplified `app/page.tsx`**:
- Should be ~100-150 lines max
- Imports and composes the above components
- Uses `useTrades()` hook for state
- Renders `<Sidebar>`, `<Toolbar>`, and the active tab component inside `<AnimatePresence>`

### Constraints
- Do NOT change any functionality — this is a pure refactor
- Keep all existing animations (motion/react)
- Keep the same visual layout and styling
- All existing features must work identically after refactor
- Run `npm run build` after refactoring to verify no type errors

---

## 3. Build Out the Backtesting Tab

### Current State
The backtesting tab (`page.tsx:1111-1171`) renders:
- A heading "Backtesting Engine"
- A search input (no state binding — non-functional)
- A file upload area (files go to `contextFiles` state but are never used)
- A "Connect Charles Schwab" button (opens OAuth popup, stores tokens, but tokens are never used)

The Schwab OAuth flow is implemented (`/api/auth/schwab/url`, `/api/auth/schwab/callback`) and tokens are stored in the `schwab_tokens` table, but no API calls use the tokens.

### Required Changes

**Fix Schwab OAuth env validation** — In `/api/auth/schwab/url/route.ts`:
- Check if `SCHWAB_CLIENT_ID` is defined before using it
- Return a 500 error with `{ error: 'Schwab integration not configured' }` if missing

**Create `/api/schwab/market-data/route.ts`**:
- GET endpoint that accepts `?symbol=NVDA` query param
- Retrieves the user's Schwab access token from `schwab_tokens` table
- Checks if token is expired; if so, refreshes using the refresh token
- Calls Schwab Market Data API to fetch historical price data (daily candles)
- Returns the data as JSON
- If no Schwab token exists, return 401 with `{ error: 'Schwab not connected' }`

**Create `/api/schwab/status/route.ts`**:
- GET endpoint that checks if the current user has a valid (non-expired) Schwab connection
- Returns `{ connected: true/false, expiresAt?: string }`

**Build `components/trading/BacktestingTab.tsx`**:
- **Connection status**: Show whether Schwab is connected (green badge) or not (prompt to connect)
- **Symbol search**: Functional search input with state binding. On submit (Enter key), fetch historical data from `/api/schwab/market-data?symbol=XXX`
- **Price chart**: Display fetched historical data using Recharts (candlestick or line chart, consistent with existing PerformanceCharts styling)
- **Context files**: The file upload area should display uploaded files and allow removal (this part already works via `contextFiles` state — just move it into this component)
- **Error states**: Handle cases where Schwab isn't connected, symbol not found, API rate limited, token expired
- **Loading states**: Show skeleton/spinner while fetching data

**Note on Schwab API**: The Schwab Developer API may have specific endpoint URLs and authentication patterns. The implementation should follow their OAuth 2.0 token refresh flow. If exact API endpoints are unclear, structure the code so the base URL and endpoints are configurable via environment variables:
```
SCHWAB_API_BASE_URL=https://api.schwabapi.com
```

### Constraints
- Use existing UI patterns (shadcn components, emerald theme, dark cards with `bg-[#121214]`)
- Use Recharts for any new charts (already a dependency)
- All API routes must validate authentication via `auth()` from NextAuth
- Schwab tokens must never be exposed to the client — all Schwab API calls go through server-side API routes

---

## 4. Bug Fixes & Polish

### CSV Import: Warn About Skipped Trades
**File: `lib/csv-parser.ts`**
- The `processCsvData()` function currently silently drops executions that don't pair (entry without matching exit, or vice versa)
- Modify the return type to include a `warnings: string[]` array
- Add warnings like `"Skipped unmatched BUY execution for AAPL (no matching sell)"` for each dropped execution
- **File: `app/page.tsx` (or the refactored equivalent)**
- After CSV import, if `warnings.length > 0`, show a toast with the count: `toast.warning(\`${warnings.length} executions skipped (unmatched)\`)`

### Remove Unused Dependency
**File: `package.json`**
- Remove `firebase-tools` from devDependencies — it's unused
- Run `npm install` after to update lockfile

### Schwab OAuth URL Validation (covered in workstream 3)
Already described above — validate `SCHWAB_CLIENT_ID` exists before building the OAuth URL.

---

## File Summary

### New Files to Create
| File | Purpose |
|------|---------|
| `app/login/page.tsx` | Dedicated login page with Google sign-in |
| `middleware.ts` | Route protection — redirect unauthenticated users to `/login` |
| `hooks/use-trades.ts` | Custom hook extracting all trade state & handlers from page.tsx |
| `components/trading/Sidebar.tsx` | Left sidebar navigation component |
| `components/trading/Toolbar.tsx` | Top toolbar with search, import, filters, bulk actions |
| `components/trading/DashboardTab.tsx` | Dashboard tab content (stats + recent trades) |
| `components/trading/JournalTab.tsx` | Journal tab content (full trade table) |
| `components/trading/PerformanceTab.tsx` | Performance tab content (charts) |
| `components/trading/FilterTab.tsx` | Filter tab content (date range, presets, tags) |
| `components/trading/BacktestingTab.tsx` | Backtesting tab with Schwab integration |
| `app/api/schwab/market-data/route.ts` | Fetch historical price data via Schwab API |
| `app/api/schwab/status/route.ts` | Check Schwab connection status |

### Files to Modify
| File | Changes |
|------|---------|
| `app/page.tsx` | Major simplification — compose extracted components, remove bell icon, remove inline sign-in |
| `lib/auth-config.ts` | Change `pages.signIn` from `'/'` to `'/login'` |
| `app/api/auth/schwab/url/route.ts` | Add env var validation for `SCHWAB_CLIENT_ID` |
| `lib/csv-parser.ts` | Add `warnings` array to return type for skipped executions |
| `package.json` | Remove `firebase-tools` |

### Files to Delete
None.

---

## Implementation Order

1. **Login page + middleware** (workstream 1) — smallest scope, highest UX impact
2. **Refactor page.tsx** (workstream 2) — makes workstream 3 easier to implement
3. **Backtesting tab** (workstream 3) — depends on clean component structure
4. **Bug fixes & polish** (workstream 4) — can be done at any point

---

## Tech Stack Reference

- **Framework**: Next.js 15 (App Router, `'use client'` components)
- **Auth**: NextAuth v5 (beta 30) with Google provider, JWT strategy
- **Database**: Turso (LibSQL) with localStorage fallback
- **UI**: shadcn/ui (New York style), Tailwind CSS v4, Radix primitives
- **Charts**: Recharts v3
- **Forms**: React Hook Form + Zod v4
- **Animations**: motion (Framer Motion) v12
- **Toasts**: Sonner v2
- **Icons**: Lucide React

## Existing Patterns to Follow

- API routes use `auth()` from `@/lib/auth-config` for session validation
- Database access via `getDb()` singleton from `@/lib/db`
- User validation via `requireUser()` and `ensureUser()` from `@/lib/server-db-utils`
- Toast notifications via `toast()`, `toast.success()`, `toast.error()` from Sonner
- All components use Tailwind classes with the existing dark theme variables
- Card backgrounds: `bg-[#121214] border border-white/5 rounded-2xl`
- Primary accent: emerald (`text-emerald-500`, `bg-emerald-500/10`)
- Animations: `motion.div` with `initial/animate/exit` opacity + y-translate

---

## 5. Migrate Database from Turso/SQLite to PostgreSQL (Drizzle ORM + Neon)

### Objective

Replace the Turso (libsql/SQLite) database backend with PostgreSQL hosted on Neon, using Drizzle ORM for type-safe schema management, queries, and migrations. This is a full backend migration that touches every file in the database layer.

### Current State

**Database client** — `lib/db.ts` (114 lines):
- Library: `@libsql/client` v0.17.0
- Pattern: Singleton `getDb()` returns a Turso `Client`. `initDb()` runs `db.executeMultiple(...)` with raw DDL to auto-create all tables.
- Env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- Fallback: If `TURSO_DATABASE_URL` is unset, `getDb()` returns `null` and the app falls back to localStorage.

**Files that import `@libsql/client` types:**
1. `lib/db.ts` — `createClient, type Client`
2. `lib/server-db-utils.ts` — `type Client, type InValue`
3. `lib/schwab.ts` — `type Client, type InValue`
4. `app/api/schwab/sync/route.ts` — `type InValue`

**Schema (6 tables, 3 indexes)** — all in `lib/db.ts` `initDb()`:
1. `users` — id TEXT PK, email TEXT UNIQUE NOT NULL, name TEXT, picture TEXT, created_at TEXT DEFAULT datetime('now')
2. `trades` — id TEXT PK, user_id FK→users, date TEXT, sort_key TEXT, symbol TEXT, direction TEXT CHECK, avg_entry_price REAL, avg_exit_price REAL, total_quantity REAL, pnl REAL, executions INTEGER, initial_risk REAL, commission REAL, fees REAL, notes TEXT, created_at TEXT DEFAULT datetime('now')
3. `trade_tags` — trade_id TEXT FK→trades ON DELETE CASCADE, tag TEXT, composite PK (trade_id, tag)
4. `tags` — id INTEGER PK AUTOINCREMENT, user_id FK→users, name TEXT, UNIQUE(user_id, name)
5. `schwab_tokens` — user_id TEXT PK FK→users, access_token TEXT, refresh_token TEXT, expires_at TEXT, updated_at TEXT DEFAULT datetime('now')
6. `broker_sync_log` — id INTEGER PK AUTOINCREMENT, user_id FK→users, broker TEXT, account_number TEXT, sync_start TEXT, sync_end TEXT, trades_synced INTEGER, synced_at TEXT DEFAULT datetime('now')

Note: The existing `token_refresh_log`, `discord_user_links`, and `price_alerts` tables are excluded from this migration. They have no frontend consumers — `token_refresh_log` is a write-only audit trail, and the other two are only used by the Discord bot service. They can be added later if needed.

Indexes: `idx_trades_user_sort_key`, `idx_trade_tags_trade_id`, `idx_tags_user_id`

**Files that execute database queries** (14 files total):

| # | File | Query Patterns |
|---|------|----------------|
| 1 | `lib/db.ts` | DDL via `executeMultiple` |
| 2 | `lib/server-db-utils.ts` | INSERT...ON CONFLICT (upsert user), SELECT...WHERE IN (load tags) |
| 3 | `lib/schwab.ts` | SELECT (load token), UPDATE (save refreshed token) |
| 4 | `app/api/trades/route.ts` | SELECT all, INSERT...ON CONFLICT (upsert), DELETE trade_tags, INSERT OR IGNORE |
| 5 | `app/api/trades/[id]/route.ts` | Dynamic UPDATE, DELETE trade_tags, INSERT OR IGNORE, SELECT, DELETE |
| 6 | `app/api/trades/bulk/route.ts` | BEGIN/COMMIT/ROLLBACK, DELETE, UPDATE, INSERT OR IGNORE |
| 7 | `app/api/trades/import/route.ts` | BEGIN/COMMIT/ROLLBACK, INSERT...ON CONFLICT, INSERT OR IGNORE, SELECT |
| 8 | `app/api/tags/route.ts` | SELECT, INSERT OR IGNORE, DELETE (2 queries) |
| 9 | `app/api/auth/schwab/callback/route.ts` | INSERT...ON CONFLICT with datetime('now') |
| 10 | `app/api/schwab/status/route.ts` | Calls `getValidSchwabToken()` |
| 11 | `app/api/schwab/accounts/route.ts` | Calls `getValidSchwabToken()` |
| 12 | `app/api/schwab/market-data/route.ts` | Calls `getValidSchwabToken()` |
| 13 | `app/api/schwab/sync/route.ts` | SELECT broker_sync_log, INSERT OR REPLACE trades, INSERT broker_sync_log |
| 14 | `app/api/health/route.ts` | Calls `getDb()` and `initDb()` |

Note: `app/api/discord/link/route.ts`, `app/api/discord/alerts/route.ts`, and `app/api/webhooks/trade-event/route.ts` are excluded — they have no frontend consumers. The webhook route contains no DB queries (it's a stub). The Discord routes will need migration only if the Discord bot is brought into scope later.

**SQLite-specific constructs that must be translated:**

| SQLite | PostgreSQL/Drizzle Equivalent |
|--------|------------------------------|
| `TEXT` for string columns | `text()` — same |
| `REAL` for decimals | `doublePrecision()` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `serial()` |
| `datetime('now')` in DEFAULT | `defaultNow()` using `timestamp` column |
| `datetime('now')` in INSERT/UPDATE | `new Date()` or `sql\`NOW()\`` |
| `INSERT OR IGNORE INTO` | `db.insert().onConflictDoNothing()` |
| `INSERT OR REPLACE INTO` | `db.insert().onConflictDoUpdate()` |
| `INSERT...ON CONFLICT(col) DO UPDATE` | `db.insert().onConflictDoUpdate({ target: col })` |
| `db.executeMultiple()` | Not needed — Drizzle migrations handle schema |
| `result.lastInsertRowid` | Use `.returning({ id })` |
| Manual `BEGIN/COMMIT/ROLLBACK` | `db.transaction(async (tx) => { ... })` via Pool-based client |
| `?` positional params | Not needed — Drizzle query builder handles parameterization |
| `db.execute({ sql, args })` calling convention | Drizzle query builder (no raw SQL) |

### Required Changes

#### Change 1: Install Dependencies

**File:** `package.json`
**Action:** MODIFY

Remove `@libsql/client`. Add Drizzle ORM, Drizzle Kit, and the Neon serverless driver:

```bash
npm uninstall @libsql/client
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit
```

**Acceptance Criteria:**
- [ ] `@libsql/client` is NOT in `package.json`
- [ ] `drizzle-orm` and `@neondatabase/serverless` are in `dependencies`
- [ ] `drizzle-kit` is in `devDependencies`
- [ ] `npm install` succeeds

#### Change 2: Create Drizzle Schema — `lib/db/schema.ts`

**File:** `lib/db/schema.ts`
**Action:** CREATE

Define all 6 tables using Drizzle's `pgTable` builder. This replaces the raw DDL in the old `initDb()`.

```typescript
import { pgTable, text, doublePrecision, integer, serial, boolean, timestamp, primaryKey, index, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  picture: text('picture'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const trades = pgTable('trades', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  sortKey: text('sort_key').notNull(),
  symbol: text('symbol').notNull(),
  direction: text('direction', { enum: ['LONG', 'SHORT'] }).notNull(),
  avgEntryPrice: doublePrecision('avg_entry_price').notNull(),
  avgExitPrice: doublePrecision('avg_exit_price').notNull(),
  totalQuantity: doublePrecision('total_quantity').notNull(),
  pnl: doublePrecision('pnl').notNull(),
  executions: integer('executions').notNull().default(1),
  initialRisk: doublePrecision('initial_risk'),
  commission: doublePrecision('commission').default(0),
  fees: doublePrecision('fees').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_trades_user_sort_key').on(table.userId, table.sortKey),
]);

export const tradeTags = pgTable('trade_tags', {
  tradeId: text('trade_id').notNull().references(() => trades.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
}, (table) => [
  primaryKey({ columns: [table.tradeId, table.tag] }),
  index('idx_trade_tags_trade_id').on(table.tradeId),
]);

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
}, (table) => [
  unique().on(table.userId, table.name),
  index('idx_tags_user_id').on(table.userId),
]);

export const schwabTokens = pgTable('schwab_tokens', {
  userId: text('user_id').primaryKey().references(() => users.id),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: text('expires_at').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const brokerSyncLog = pgTable('broker_sync_log', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  broker: text('broker').notNull(),
  accountNumber: text('account_number').notNull(),
  syncStart: text('sync_start').notNull(),
  syncEnd: text('sync_end').notNull(),
  tradesSynced: integer('trades_synced').notNull().default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
});
```

**Acceptance Criteria:**
- [ ] All 6 tables are defined with correct column types, constraints, and defaults
- [ ] All 3 indexes are defined
- [ ] Foreign keys match the original schema
- [ ] `REAL` → `doublePrecision`, `INTEGER AUTOINCREMENT` → `serial`, `datetime('now')` → `timestamp().defaultNow()`
- [ ] `token_refresh_log`, `discord_user_links`, and `price_alerts` are NOT included

#### Change 3: Create Drizzle Config — `drizzle.config.ts`

**File:** `drizzle.config.ts` (project root)
**Action:** CREATE

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Also add migration scripts to `package.json`:**
```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

**Acceptance Criteria:**
- [ ] `drizzle.config.ts` exists at project root
- [ ] Points to `lib/db/schema.ts` for schema
- [ ] Outputs migrations to `./drizzle/`
- [ ] All 4 db scripts added to `package.json`

#### Change 4: Rewrite `lib/db.ts` — Neon + Drizzle Client (HTTP + Pool)

**File:** `lib/db.ts`
**Action:** MODIFY (full rewrite)

Replace the Turso client with two Drizzle instances backed by Neon:
1. **HTTP client** (`neon-http`) — for all standard reads and single-statement writes. Lightweight, no connection overhead.
2. **Pool client** (`neon-serverless` with WebSocket) — for transactional writes only (bulk operations, imports). Required because Neon HTTP mode does not support interactive transactions.

```typescript
import { neon, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './db/schema';

let httpDb: NeonHttpDatabase<typeof schema> | null = null;
let poolDb: NeonDatabase<typeof schema> | null = null;

/** HTTP-based client for reads and single-statement writes. */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!httpDb) {
    const sql = neon(process.env.DATABASE_URL);
    httpDb = drizzleHttp(sql, { schema });
  }

  return httpDb;
}

/** Pool-based client for transactional writes (bulk, import). */
export function getPoolDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!poolDb) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    poolDb = drizzleWs(pool, { schema });
  }

  return poolDb;
}

// Type aliases for use in function signatures across the codebase
export type Db = NonNullable<ReturnType<typeof getDb>>;
export type PoolDb = NonNullable<ReturnType<typeof getPoolDb>>;
```

**Key differences from the old `lib/db.ts`:**
- No `initDb()` function — schema is managed via Drizzle migrations (`npm run db:push` or `npm run db:migrate`), not auto-created at runtime
- Two clients: `getDb()` returns the HTTP client (used by most routes), `getPoolDb()` returns the Pool client (used only by `trades/bulk` and `trades/import` for transactions)
- Single `DATABASE_URL` env var replaces `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
- The `Db` and `PoolDb` type exports replace `Client` from `@libsql/client`

**When to use which client:**
- `getDb()` (HTTP) — all GET handlers, single INSERT/UPDATE/DELETE operations, `ensureUser()`, `getValidSchwabToken()`, etc.
- `getPoolDb()` (Pool) — only routes that need `db.transaction()`: `trades/bulk` and `trades/import`

**Acceptance Criteria:**
- [ ] `getDb()` returns an HTTP-based Drizzle instance when `DATABASE_URL` is set, `null` otherwise
- [ ] `getPoolDb()` returns a Pool-based Drizzle instance when `DATABASE_URL` is set, `null` otherwise
- [ ] No `initDb()` function — remove entirely
- [ ] Both `Db` and `PoolDb` types are exported
- [ ] No imports from `@libsql/client`
- [ ] No raw SQL DDL in this file

#### Change 5: Rewrite `lib/server-db-utils.ts`

**File:** `lib/server-db-utils.ts`
**Action:** MODIFY

Replace all raw SQL with Drizzle query builder calls. Replace `Client` type with `Db`.

**New implementation:**

```typescript
import { eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth-config';
import { type Db } from '@/lib/db';
import { users, trades, tradeTags } from '@/lib/db/schema';

export type ApiTrade = {
  id: string;
  date: string;
  sortKey: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  pnl: number;
  executions: number;
  initialRisk?: number;
  commission?: number;
  fees?: number;
  tags: string[];
  notes?: string;
};

export async function requireUser() {
  // ... unchanged — no DB calls here
}

export async function ensureUser(db: Db, user: { id: string; email: string; name: string | null; picture: string | null }) {
  await db.insert(users)
    .values({ id: user.id, email: user.email, name: user.name, picture: user.picture })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: user.email, name: user.name, picture: user.picture },
    });
}

export function dbUnavailable() {
  return Response.json({ error: 'Database not configured' }, { status: 503 });
}

export function toTrade(row: typeof trades.$inferSelect, tradeTags: string[] = []): ApiTrade {
  return {
    id: row.id,
    date: row.date,
    sortKey: row.sortKey,
    symbol: row.symbol,
    direction: row.direction,
    avgEntryPrice: row.avgEntryPrice,
    avgExitPrice: row.avgExitPrice,
    totalQuantity: row.totalQuantity,
    pnl: row.pnl,
    executions: row.executions,
    initialRisk: row.initialRisk ?? undefined,
    commission: row.commission ?? 0,
    fees: row.fees ?? 0,
    tags: tradeTags,
    notes: row.notes ?? undefined,
  };
}

export async function loadTagsForTradeIds(db: Db, tradeIds: string[]) {
  if (tradeIds.length === 0) return new Map<string, string[]>();

  const rows = await db.select()
    .from(tradeTags)
    .where(inArray(tradeTags.tradeId, tradeIds));

  const tagMap = new Map<string, string[]>();
  for (const row of rows) {
    const list = tagMap.get(row.tradeId) ?? [];
    list.push(row.tag);
    tagMap.set(row.tradeId, list);
  }
  return tagMap;
}
```

**Key differences:**
- `import type { Client, InValue } from '@libsql/client'` → replaced with `Db` from `lib/db` and schema imports
- `ensureUser()` uses `db.insert().onConflictDoUpdate()` instead of raw SQL
- `toTrade()` receives a fully-typed `typeof trades.$inferSelect` row instead of `Record<string, InValue>` — Drizzle returns camelCase properties matching the schema definition, so no more `String(row.sort_key)` manual casting
- `loadTagsForTradeIds()` uses `db.select().from().where(inArray())` instead of raw SQL with dynamic `?` placeholders
- **Remove** `initDb()` import — it no longer exists

**Acceptance Criteria:**
- [ ] No imports from `@libsql/client`
- [ ] All functions use `Db` type instead of `Client`
- [ ] `toTrade()` leverages Drizzle's typed row output — no `String()` / `Number()` casts
- [ ] `ensureUser()` uses Drizzle insert with `onConflictDoUpdate`
- [ ] `loadTagsForTradeIds()` uses `inArray()` operator

#### Change 6: Rewrite `lib/schwab.ts`

**File:** `lib/schwab.ts`
**Action:** MODIFY

Replace `@libsql/client` types and raw SQL with Drizzle queries.

**Specific changes:**

1. **Import changes:**
   - Remove: `import type { Client, InValue } from '@libsql/client'`
   - Add: `import { eq } from 'drizzle-orm'`
   - Add: `import { type Db } from '@/lib/db'`
   - Add: `import { schwabTokens } from '@/lib/db/schema'`

2. **`readTokenRow()`** — DELETE this function. Drizzle returns typed objects directly.

3. **`loadUserSchwabToken(db: Db, userId: string)`:**
   ```typescript
   const rows = await db.select().from(schwabTokens).where(eq(schwabTokens.userId, userId)).limit(1);
   const row = rows[0];
   if (!row) return null;
   return {
     accessToken: row.accessToken,
     refreshToken: row.refreshToken,
     expiresAt: row.expiresAt,
   };
   ```

4. **Remove `logTokenRefresh()`** — this function wrote to `token_refresh_log`, which is excluded from this migration. Delete the function entirely. If callers reference it, replace those calls with `console.info('[schwab] token refreshed', { userId, rotated: true })` so token refresh events remain observable in server logs during development. A structured logger can replace this later.

5. **Token UPDATE in `getValidSchwabToken()`:**
   ```typescript
   await db.update(schwabTokens)
     .set({
       accessToken: refreshed.accessToken,
       refreshToken: refreshed.refreshToken,
       expiresAt: refreshed.expiresAt,
       updatedAt: new Date(),
     })
     .where(eq(schwabTokens.userId, userId));
   ```

6. **All function signatures:** `db: Client` → `db: Db`

**Acceptance Criteria:**
- [ ] No imports from `@libsql/client`
- [ ] `readTokenRow()` is deleted
- [ ] `logTokenRefresh()` is deleted (the `token_refresh_log` table is excluded)
- [ ] `datetime('now')` replaced with `new Date()` for `updatedAt`
- [ ] All queries use Drizzle query builder

#### Change 7: Update `app/api/trades/route.ts`

**File:** `app/api/trades/route.ts`
**Action:** MODIFY

**GET handler:**
```typescript
import { eq, desc } from 'drizzle-orm';
import { trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';

const tradeRows = await db.select().from(trades)
  .where(eq(trades.userId, authState.user.id))
  .orderBy(desc(trades.date));
```

**POST handler — upsert trade:**
```typescript
await db.insert(trades).values({
  id: body.id,
  userId: authState.user.id,
  date: body.date,
  sortKey: body.sortKey,
  symbol: body.symbol,
  direction: body.direction,
  avgEntryPrice: body.avgEntryPrice ?? 0,
  avgExitPrice: body.avgExitPrice ?? 0,
  totalQuantity: body.totalQuantity ?? 0,
  pnl: body.pnl ?? 0,
  executions: body.executions ?? 1,
  initialRisk: body.initialRisk ?? null,
  commission: body.commission ?? 0,
  fees: body.fees ?? 0,
  notes: body.notes ?? null,
}).onConflictDoUpdate({
  target: trades.id,
  set: {
    date: body.date,
    sortKey: body.sortKey,
    symbol: body.symbol,
    direction: body.direction,
    avgEntryPrice: body.avgEntryPrice ?? 0,
    avgExitPrice: body.avgExitPrice ?? 0,
    totalQuantity: body.totalQuantity ?? 0,
    pnl: body.pnl ?? 0,
    executions: body.executions ?? 1,
    initialRisk: body.initialRisk ?? null,
    commission: body.commission ?? 0,
    fees: body.fees ?? 0,
    notes: body.notes ?? null,
  },
});
```

**POST handler — tags:**
```typescript
if (Array.isArray(body.tags)) {
  await db.delete(tradeTagsTable).where(eq(tradeTagsTable.tradeId, body.id));
  for (const tag of body.tags) {
    await db.insert(tradeTagsTable).values({ tradeId: body.id, tag }).onConflictDoNothing();
    await db.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
  }
}
```

**POST handler — re-read created trade:**
```typescript
const [created] = await db.select().from(trades)
  .where(eq(trades.id, body.id))
  .limit(1);
```

**Acceptance Criteria:**
- [ ] All `db.execute({ sql, args })` calls replaced with Drizzle query builder
- [ ] `INSERT OR IGNORE` → `.onConflictDoNothing()`
- [ ] `INSERT...ON CONFLICT DO UPDATE` → `.onConflictDoUpdate()`

#### Change 8: Update `app/api/trades/[id]/route.ts`

**File:** `app/api/trades/[id]/route.ts`
**Action:** MODIFY

**PATCH handler — dynamic update:**
```typescript
import { eq, and } from 'drizzle-orm';

const updateData: Partial<typeof trades.$inferInsert> = {};
if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
  updateData.notes = body.notes?.trim() || null;
}
if (Object.prototype.hasOwnProperty.call(body, 'initialRisk')) {
  updateData.initialRisk = body.initialRisk ?? null;
}

if (Object.keys(updateData).length > 0) {
  await db.update(trades)
    .set(updateData)
    .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
}
```

**PATCH handler — tags:** Same pattern as Change 7 (delete then re-insert with `onConflictDoNothing`).

**PATCH handler — re-read trade:**
```typescript
const [trade] = await db.select().from(trades)
  .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
  .limit(1);
const tagRows = await db.select({ tag: tradeTagsTable.tag })
  .from(tradeTagsTable).where(eq(tradeTagsTable.tradeId, id));
const tagList = tagRows.map((r) => r.tag);
```

**DELETE handler:**
```typescript
await db.delete(trades)
  .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
```

**Acceptance Criteria:**
- [ ] Dynamic UPDATE uses a partial object + `db.update().set()`
- [ ] No raw SQL or `?` placeholders

#### Change 9: Update `app/api/trades/bulk/route.ts`

**File:** `app/api/trades/bulk/route.ts`
**Action:** MODIFY

Replace manual `BEGIN/COMMIT/ROLLBACK` with Drizzle's `db.transaction()` using the **Pool-based client** (`getPoolDb()`). The Neon HTTP driver does NOT support interactive transactions — only the Pool/WebSocket driver does.

**Key import change:**
```typescript
import { getPoolDb } from '@/lib/db';
// NOT getDb() — this route needs transactional writes
```

Get the pool client at the top of the handler:
```typescript
const db = getPoolDb();
if (!db) return dbUnavailable();
```

**Wrap all writes in a transaction:**
```typescript
import { eq, and } from 'drizzle-orm';
import { trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';

await db.transaction(async (tx) => {
  if (body.action === 'delete') {
    for (const id of body.ids) {
      await tx.delete(trades)
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
    }
  }

  if (body.action === 'applyRisk') {
    // ... validation ...
    for (const id of body.ids) {
      await tx.update(trades)
        .set({ initialRisk: risk })
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
    }
  }

  if (body.action === 'addTag') {
    // ... validation ...
    await tx.insert(tagsTable)
      .values({ userId: authState.user.id, name: tag })
      .onConflictDoNothing();
    for (const id of body.ids) {
      await tx.insert(tradeTagsTable)
        .values({ tradeId: id, tag })
        .onConflictDoNothing();
    }
  }
});
```

Note: All operations inside the callback use `tx` (the transaction handle), not `db`. If any operation throws, the entire transaction is rolled back automatically.

**Acceptance Criteria:**
- [ ] Uses `getPoolDb()` instead of `getDb()`
- [ ] All writes wrapped in `db.transaction(async (tx) => { ... })`
- [ ] All queries inside the callback use `tx`, not `db`
- [ ] No manual `BEGIN/COMMIT/ROLLBACK`
- [ ] All `INSERT OR IGNORE` → `.onConflictDoNothing()`

#### Change 10: Update `app/api/trades/import/route.ts`

**File:** `app/api/trades/import/route.ts`
**Action:** MODIFY

Same dual-client pattern as Change 9. Use the **Pool-based client** (`getPoolDb()`) for transactional writes.

**Key import change:**
```typescript
import { getPoolDb } from '@/lib/db';
// NOT getDb() — this route needs transactional writes
```

Get the pool client at the top of the handler:
```typescript
const db = getPoolDb();
if (!db) return dbUnavailable();
```

**Wrap the entire import loop in a transaction:**
```typescript
await db.transaction(async (tx) => {
  for (const trade of body.trades) {
    await tx.insert(trades).values({
      id: trade.id,
      userId: authState.user.id,
      date: trade.date,
      sortKey: trade.sortKey,
      symbol: trade.symbol,
      direction: trade.direction,
      avgEntryPrice: trade.avgEntryPrice,
      avgExitPrice: trade.avgExitPrice,
      totalQuantity: trade.totalQuantity,
      pnl: trade.pnl,
      executions: trade.executions,
      initialRisk: trade.initialRisk ?? null,
      commission: trade.commission ?? 0,
      fees: trade.fees ?? 0,
      notes: trade.notes ?? null,
    }).onConflictDoUpdate({
      target: trades.id,
      set: {
        avgEntryPrice: trade.avgEntryPrice,
        avgExitPrice: trade.avgExitPrice,
        totalQuantity: trade.totalQuantity,
        pnl: trade.pnl,
        executions: trade.executions,
        commission: trade.commission ?? 0,
        fees: trade.fees ?? 0,
      },
    });

    if (trade.tags?.length) {
      for (const tag of trade.tags) {
        await tx.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
        await tx.insert(tradeTagsTable).values({ tradeId: trade.id, tag }).onConflictDoNothing();
      }
    }
  }
});
```

Note: All operations inside the callback use `tx` (the transaction handle), not `db`. If any trade fails to import, the entire batch is rolled back — no partial imports.

**Acceptance Criteria:**
- [ ] Uses `getPoolDb()` instead of `getDb()`
- [ ] All writes wrapped in `db.transaction(async (tx) => { ... })`
- [ ] All queries inside the callback use `tx`, not `db`
- [ ] No manual `BEGIN/COMMIT/ROLLBACK`
- [ ] Import upsert uses `onConflictDoUpdate` with selective fields (preserves notes/tags/initialRisk)

#### Change 11: Update `app/api/tags/route.ts`

**File:** `app/api/tags/route.ts`
**Action:** MODIFY

```typescript
import { eq, and, asc, inArray } from 'drizzle-orm';
import { tags as tagsTable, tradeTags as tradeTagsTable, trades } from '@/lib/db/schema';

// GET
const result = await db.select({ name: tagsTable.name })
  .from(tagsTable)
  .where(eq(tagsTable.userId, authState.user.id))
  .orderBy(asc(tagsTable.name));
const tagNames = result.map((r) => r.name);

// POST
await db.insert(tagsTable)
  .values({ userId: authState.user.id, name })
  .onConflictDoNothing();

// DELETE
await db.delete(tagsTable)
  .where(and(eq(tagsTable.userId, authState.user.id), eq(tagsTable.name, name)));

// Delete orphaned trade_tags: subquery for user's trade IDs
const userTradeIds = db.select({ id: trades.id }).from(trades).where(eq(trades.userId, authState.user.id));
await db.delete(tradeTagsTable)
  .where(and(inArray(tradeTagsTable.tradeId, userTradeIds), eq(tradeTagsTable.tag, name)));
```

**Acceptance Criteria:**
- [ ] All 3 handlers (GET, POST, DELETE) use Drizzle query builder
- [ ] DELETE uses a subquery for the user's trade IDs

#### Change 12: Update `app/api/auth/schwab/callback/route.ts`

**File:** `app/api/auth/schwab/callback/route.ts`
**Action:** MODIFY

Replace the raw SQL upsert with Drizzle:

```typescript
import { schwabTokens } from '@/lib/db/schema';

await db.insert(schwabTokens).values({
  userId: user.id,
  accessToken: tokenData.access_token,
  refreshToken: tokenData.refresh_token,
  expiresAt,
  updatedAt: new Date(),
}).onConflictDoUpdate({
  target: schwabTokens.userId,
  set: {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
    updatedAt: new Date(),
  },
});
```

Also update the `ensureUser()` call — it now takes `Db` instead of `Client`. Import `type Db` from `@/lib/db`.

**Acceptance Criteria:**
- [ ] `datetime('now')` → `new Date()` for `updatedAt`
- [ ] Uses Drizzle `onConflictDoUpdate`

#### Change 13: Update `app/api/schwab/sync/route.ts`

**File:** `app/api/schwab/sync/route.ts`
**Action:** MODIFY

**Critical changes:**
1. **Remove:** `import type { InValue } from '@libsql/client'` (line 7)
2. **Cooldown check:**
   ```typescript
   import { eq, and, desc } from 'drizzle-orm';
   import { brokerSyncLog, trades } from '@/lib/db/schema';

   const [lastSync] = await db.select({ syncedAt: brokerSyncLog.syncedAt })
     .from(brokerSyncLog)
     .where(and(eq(brokerSyncLog.userId, authState.user.id), eq(brokerSyncLog.accountNumber, accountId)))
     .orderBy(desc(brokerSyncLog.syncedAt))
     .limit(1);
   ```
   Access as `lastSync?.syncedAt` — Drizzle returns a `Date` object for timestamp columns, so use `.getTime()` directly.

3. **Trade upsert** — replace `INSERT OR REPLACE` with `onConflictDoUpdate` that selectively updates only market-data fields (preserves user-added notes/tags/initialRisk):
   ```typescript
   await db.insert(trades).values({
     id: tradeId,
     userId: authState.user.id,
     date: new Date(trade.date).toISOString(),
     sortKey: trade.sortKey,
     symbol: trade.symbol,
     direction: trade.direction,
     avgEntryPrice: trade.avgEntryPrice,
     avgExitPrice: trade.avgExitPrice,
     totalQuantity: trade.totalQuantity,
     pnl: trade.pnl,
     executions: trade.executions,
     commission: trade.commission ?? 0,
     fees: trade.fees ?? 0,
   }).onConflictDoUpdate({
     target: trades.id,
     set: {
       avgEntryPrice: trade.avgEntryPrice,
       avgExitPrice: trade.avgExitPrice,
       totalQuantity: trade.totalQuantity,
       pnl: trade.pnl,
       executions: trade.executions,
       commission: trade.commission ?? 0,
       fees: trade.fees ?? 0,
     },
   });
   ```

4. **Sync log insert:**
   ```typescript
   await db.insert(brokerSyncLog).values({
     userId: authState.user.id,
     broker: 'schwab',
     accountNumber: accountId,
     syncStart: start.toISOString(),
     syncEnd: end.toISOString(),
     tradesSynced: allTrades.length,
   });
   ```

**Acceptance Criteria:**
- [ ] `@libsql/client` import removed
- [ ] `INSERT OR REPLACE` → `onConflictDoUpdate` with selective fields
- [ ] `datetime('now')` → handled by `defaultNow()` in schema (omit from `.values()`)
- [ ] Cooldown check uses Drizzle select with typed timestamp access

#### Change 14: Update `app/api/schwab/status/route.ts`, `accounts/route.ts`, `market-data/route.ts`

**Files:** 3 Schwab API routes
**Action:** MODIFY (minimal)

These routes don't execute queries directly — they call `getValidSchwabToken()` from `lib/schwab.ts` and pass `db` to it. The only change needed is the type of `db`:
- `getDb()` now returns `Db | null` instead of `Client | null`
- Since `getValidSchwabToken()` already accepts `Db` (after Change 6), these files just need to update their imports if they explicitly type `db`

**Acceptance Criteria:**
- [ ] No type errors when `getDb()` returns the new Drizzle type

#### Change 15: Update `app/api/health/route.ts`

**File:** `app/api/health/route.ts`
**Action:** MODIFY

Remove the `initDb()` call (it no longer exists). Just check if `getDb()` returns a non-null value:

```typescript
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  if (!db) {
    return Response.json({ db: false }, { status: 503 });
  }
  return Response.json({ db: true });
}
```

Optionally, add a lightweight connectivity check by running a simple query:
```typescript
import { sql } from 'drizzle-orm';
await db.execute(sql`SELECT 1`);
```

**Acceptance Criteria:**
- [ ] No `initDb()` call
- [ ] Returns `{ db: true }` when `DATABASE_URL` is configured

#### Change 16: Update Environment Variables

**File:** `.env.example`
**Action:** MODIFY

Replace:
```
# Turso Database (optional — app falls back to localStorage if not set)
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

With:
```
# PostgreSQL via Neon (optional — app falls back to localStorage if not set)
# Format: postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/nexus_terminal?sslmode=require
DATABASE_URL=
```

The value is left empty so the app falls back to localStorage by default. Developers fill in their own Neon connection string in `.env.local` (do NOT commit). `DATABASE_URL` must be set via environment variable at runtime (Vercel env vars, shell export, etc.) and must never be committed with a real value.

**Acceptance Criteria:**
- [ ] `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` removed from `.env.example`
- [ ] `DATABASE_URL=` added (empty value) with a comment showing the Neon format
- [ ] Comment accurately describes fallback behavior

#### Change 17: Update Documentation

**File:** `HANDOFF.md`
**Action:** MODIFY

Update all references to Turso/libsql/SQLite:
- Line 18: `Database | Turso (libsql), schema in lib/db.ts` → `Database | PostgreSQL via Neon (Drizzle ORM), schema in lib/db/schema.ts`
- Update env var references from `TURSO_*` to `DATABASE_URL`
- Update any mentions of `@libsql/client` to `drizzle-orm` / `@neondatabase/serverless`

**File:** `.claude/agents/nexus-architect.md`
**Action:** MODIFY

Update the database line in Project Context to reflect PostgreSQL + Drizzle + Neon.

**Acceptance Criteria:**
- [ ] No remaining references to "Turso", "libsql", or "SQLite" in `HANDOFF.md`
- [ ] Agent context reflects the new stack

---

### Files Summary for Workstream 5

#### New Files to Create
| File | Purpose |
|------|---------|
| `lib/db/schema.ts` | Drizzle ORM schema — all 6 tables, indexes, constraints |
| `drizzle.config.ts` | Drizzle Kit config for migrations |
| `drizzle/` (directory) | Generated migration SQL files (via `npm run db:generate`) |

#### Files to Modify
| # | File | Risk | Summary |
|---|------|------|---------|
| 1 | `package.json` | LOW | Swap deps + add db scripts |
| 2 | `lib/db.ts` | HIGH | Full rewrite: dual Neon clients (HTTP + Pool) + Drizzle |
| 3 | `lib/server-db-utils.ts` | HIGH | All queries → Drizzle builder, typed rows |
| 4 | `lib/schwab.ts` | HIGH | All queries → Drizzle, remove `logTokenRefresh()` |
| 5 | `app/api/trades/route.ts` | MEDIUM | Drizzle queries |
| 6 | `app/api/trades/[id]/route.ts` | MEDIUM | Drizzle queries + dynamic update |
| 7 | `app/api/trades/bulk/route.ts` | MEDIUM | Pool client + `db.transaction()`, Drizzle queries |
| 8 | `app/api/trades/import/route.ts` | MEDIUM | Pool client + `db.transaction()`, Drizzle queries |
| 9 | `app/api/tags/route.ts` | LOW | Drizzle queries |
| 10 | `app/api/auth/schwab/callback/route.ts` | MEDIUM | Drizzle upsert |
| 11 | `app/api/schwab/sync/route.ts` | HIGH | Remove libsql import, fix INSERT OR REPLACE, Drizzle queries |
| 12 | `app/api/schwab/status/route.ts` | LOW | Type compatibility |
| 13 | `app/api/schwab/accounts/route.ts` | LOW | Type compatibility |
| 14 | `app/api/schwab/market-data/route.ts` | LOW | Type compatibility |
| 15 | `app/api/health/route.ts` | LOW | Remove `initDb()` call |
| 16 | `.env.example` | LOW | Env var rename |
| 17 | `HANDOFF.md` | LOW | Doc updates |
| 18 | `.claude/agents/nexus-architect.md` | LOW | Doc updates |

### Testing Requirements

- [ ] `npm run build` completes with zero TypeScript errors
- [ ] `npm run db:push` applies schema to Neon (or local PostgreSQL) without errors
- [ ] `npm run dev` starts without errors
- [ ] `GET /api/health` returns `{ "db": true }`
- [ ] Sign in with Google OAuth succeeds
- [ ] Create a trade via UI (POST /api/trades)
- [ ] View trades list (GET /api/trades)
- [ ] Edit trade notes and tags (PATCH /api/trades/[id])
- [ ] Delete a trade (DELETE /api/trades/[id])
- [ ] Bulk delete, apply risk, add tag all work (POST /api/trades/bulk)
- [ ] Import trades via CSV (POST /api/trades/import)
- [ ] Create and delete tags (GET/POST/DELETE /api/tags)
- [ ] Schwab status check (GET /api/schwab/status)
- [ ] Existing `npm test` (vitest) passes — tests don't touch DB layer directly
- [ ] `getDb()` returns `null` when `DATABASE_URL` is unset (localStorage fallback works)
- [ ] Routes excluded from this migration (`/api/discord/link`, `/api/discord/alerts`, `/api/webhooks/trade-event`) are unchanged and must still compile and function against the existing database layer. Do not modify these files.

### Rollback Plan

1. `git checkout .` to revert all changes
2. `npm install` to restore `@libsql/client`
3. Restore `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env.local`
4. No data migration from Turso is included — this is a fresh schema. If production data exists in Turso, a separate migration script is needed.

### Security Considerations

1. **`DATABASE_URL` contains credentials.** Ensure it's only in `.env.local` (gitignored by Next.js).
2. **SQL injection:** Drizzle's query builder parameterizes all values automatically — same protection as Turso's `?` placeholders.
3. **Neon connection:** Uses SSL by default (`?sslmode=require`). Do not disable this.
4. **Schwab tokens:** Still stored as plain text. Pre-existing concern (see HANDOFF.md), unchanged by this migration.
5. **Hardcoded credentials:** Any credentials in config files (docker-compose, .env.example) are for local dev only. Production uses Neon with environment-injected secrets.

### Order of Operations

1. Install dependencies (Change 1)
2. Create `lib/db/schema.ts` (Change 2) — schema must exist before anything else
3. Create `drizzle.config.ts` (Change 3)
4. Rewrite `lib/db.ts` (Change 4) — foundation for all other files (HTTP + Pool clients)
5. Rewrite `lib/server-db-utils.ts` (Change 5) — core utility used by every route
6. Rewrite `lib/schwab.ts` (Change 6) — used by 4 Schwab routes, remove `logTokenRefresh()`
7. Update `app/api/trades/route.ts` (Change 7)
8. Update `app/api/trades/[id]/route.ts` (Change 8)
9. Update `app/api/trades/bulk/route.ts` (Change 9) — uses `getPoolDb()` + `db.transaction()`
10. Update `app/api/trades/import/route.ts` (Change 10) — uses `getPoolDb()` + `db.transaction()`
11. Update `app/api/tags/route.ts` (Change 11)
12. Update `app/api/auth/schwab/callback/route.ts` (Change 12)
13. Update `app/api/schwab/sync/route.ts` (Change 13)
14. Update Schwab status/accounts/market-data routes (Change 14)
15. Update `app/api/health/route.ts` (Change 15)
16. Update `.env.example` (Change 16)
17. Update `HANDOFF.md` and `.claude/agents/nexus-architect.md` (Change 17)
18. Run `npm run db:push` to apply schema to the database
19. Run `npm run build` — must pass with zero TypeScript errors
20. Run `npm run dev` and test manually per Testing Requirements
21. Run `npm test` — existing vitest suite must pass

---

## 6. Code Review Hardening Sprint (2026-03-03) — Completed

### Objective

Close the highest-risk authorization and auth-flow gaps found in the 2026-03-03 code review, then repair integration contracts (Discord/backtest).

### Findings to Address

1. `critical` Cross-tenant trade overwrite/read via globally-scoped `trades.id` and unscoped upserts.
2. `high` Schwab OAuth flow missing `state` protection.
3. `high` Trade-tag writes not ownership-scoped.
4. `medium` Discord bot auth and schema contracts are inconsistent with app routes.
5. `medium` Backtest command/API contract mismatch and gateway job ownership not enforced.

### Required Changes

#### Change A: Enforce tenant-safe trade identity

**Files:**
- `lib/db/schema.ts`
- `app/api/trades/route.ts`
- `app/api/trades/import/route.ts`
- `app/api/schwab/sync/route.ts`
- `app/api/trades/[id]/route.ts`
- `app/api/trades/bulk/route.ts`

**Actions:**
- Make trade uniqueness tenant-scoped (composite key/unique on `(user_id, id)` or move to surrogate PK plus unique tenant key).
- Replace all `onConflictDoUpdate({ target: trades.id })` with tenant-safe conflict targets.
- Ensure every read/update/delete path involving a trade includes `user_id` constraints.
- Prevent tag delete/insert on trades not owned by authenticated user.

**Acceptance Criteria:**
- [x] No code path can update/read another user’s trade by guessed ID.
- [x] All tag mutation paths enforce ownership.
- [x] Add tests covering cross-user collision attempts.

#### Change B: Add Schwab OAuth `state` validation

**Files:**
- `app/api/auth/schwab/url/route.ts`
- `app/api/auth/schwab/callback/route.ts`

**Actions:**
- Generate cryptographically-random `state`, bind it to user session (cookie or server store), send in auth URL.
- Verify callback `state` matches expected value; reject mismatches.
- Expire/clear used state after successful callback.

**Acceptance Criteria:**
- [x] Callback without valid state is rejected.
- [x] Replay/mismatched state is rejected.

#### Change C: Reconcile Discord API contract

**Files:**
- `services/discord-bot/src/utils.ts`
- `app/api/discord/alerts/route.ts`
- `app/api/discord/link/route.ts`
- `lib/db/schema.ts` + migration(s)

**Actions:**
- Pick one auth model for bot-to-app calls (service token/JWT or dedicated service route set) and implement consistently.
- Add missing schema tables used by Discord routes (`discord_user_links`, `price_alerts`) or remove/replace those routes.
- Align payload fields (`targetPrice` vs `price`) and response shapes.

**Acceptance Criteria:**
- [x] Bot commands authenticate successfully without relying on browser session cookies.
- [x] Discord routes execute without missing-table runtime errors.
- [x] `/alert` persists target price correctly.

#### Change D: Reconcile backtest command and gateway access control

**Files:**
- `services/discord-bot/src/commands/backtest.ts`
- `app/api/backtest/route.ts`
- `services/backtest-gateway/src/index.ts`

**Actions:**
- Align poll route contract (`/api/backtest?jobId=` vs `/api/backtest/:jobId`) across bot and app.
- Ensure submission payload includes gateway-required fields (`candles`, etc.) or adapt gateway expectations.
- Enforce job ownership check in gateway GET handler (compare requesting user to job user).

**Acceptance Criteria:**
- [x] Backtest command can submit and poll successfully.
- [x] Users cannot fetch other users’ job results.

### Validation Requirements

- [x] `npm run lint`
- [x] `npm test`
- [x] `npx tsc --noEmit`
- [x] Add/extend tests for cross-tenant trade protections and OAuth state verification

### Completion Notes

- Tenant-safe trade identity is enforced with composite keys/FKs and user-scoped tag mutations.
- Schwab OAuth now uses a generated `state` cookie with callback verification and one-time clear.
- Discord bot/app auth now supports service-token + Discord user mapping, with aligned payload contracts.
- Backtest command, app proxy, and gateway polling contracts are aligned, with gateway ownership checks.
