# Codex Prompt: Fix & Complete Nexus Terminal

## Project Overview

Nexus Terminal is a Next.js 15 (App Router) trading journal. Current stack: React 19, TypeScript, **Tailwind CSS v4** (no tailwind.config.js — uses `@import "tailwindcss"` in CSS), Recharts, Motion (Framer Motion), PapaParse for CSV. All trade data is currently in browser `localStorage`.

The codebase is working but incomplete. This prompt covers every concrete bug, broken feature, and missing wiring, plus a stack upgrade for a small (≤10 user) production app.

**Important for Codex:**
- This project uses **Tailwind CSS v4**, not v3. There is no `tailwind.config.js`. Tailwind config is done via CSS with `@theme` blocks in `globals.css`.
- Do NOT reference line numbers — they will shift as you make edits. Match code by content/context instead.
- Run `npm run dev` after major changes to verify the build passes.
- When creating new files, match the style of existing files (e.g., `'use client'` directive, import patterns, Tailwind class conventions).

---

## Current File Map (before changes)

```
app/
  page.tsx                          — Main dashboard ('use client', all tabs + state + handlers)
  layout.tsx                        — Root layout (metadata still says "My Google AI Studio App")
  globals.css                       — Minimal: just @import "tailwindcss" and base font-size
  api/auth/google/url/route.ts      — Google OAuth URL generator
  api/auth/google/callback/route.ts — Google OAuth callback
  api/auth/schwab/url/route.ts      — Schwab OAuth URL generator
  api/auth/schwab/callback/route.ts — Schwab OAuth callback (BROKEN — XSS + no token storage)
  api/auth/me/route.ts              — Get current JWT session
  api/auth/logout/route.ts          — Destroy JWT session
components/trading/
  TradeTable.tsx                    — Trade journal table
  PerformanceCharts.tsx             — Equity curve + bar charts
  TradingCalendar.tsx               — Calendar heatmap
lib/
  auth.ts                           — Hand-rolled JWT session (jose + cookies)
  csv-parser.ts                     — CSV import + entry/exit matching
  trading-utils.ts                  — formatCurrency, formatR, calculatePnL, parsePrice, getPnLColor
  types.ts                          — Trade, Direction, DateRisk, TradeTags, JournalState interfaces
  env.ts                            — getBaseUrl() for OAuth redirects
  utils.ts                          — cn() helper (clsx + tailwind-merge)
hooks/
  use-mobile.ts                     — Mobile breakpoint detection
```

### Current package.json dependencies (relevant)

Already installed: `@hookform/resolvers`, `class-variance-authority`, `clsx`, `tailwind-merge`, `date-fns`, `lucide-react`, `motion`, `papaparse`, `recharts`, `axios`, `jose`, `cookie`

**Not installed** (despite being referenced in types): `react-hook-form`, `zod`

**Installed but unused** (remove after migration): `@google/genai`, `jose`, `cookie`, `@types/cookie`, `axios`

---

## Stack Upgrade (Do This First)

### Step 1: Install Dependencies

```bash
# Auth
npm install next-auth@beta

# Database
npm install @libsql/client

# UI components — react-hook-form is NOT installed yet despite resolvers being present
npm install react-hook-form zod sonner

# shadcn — MUST use non-interactive mode for Codex
# First create components.json manually (see below), then add components
npx shadcn@latest add dialog dropdown-menu popover sheet input label select tabs command
```

**Do NOT run `npx shadcn@latest init`** — it's interactive and will hang. Instead, manually create the config files as described below.

### Step 2: Remove Unused Packages

```bash
npm uninstall @google/genai jose cookie @types/cookie axios
```

### Step 3: Create shadcn Configuration (manually, no interactive init)

Create `components.json` in the project root:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

### Step 4: Update `app/globals.css` for shadcn Dark Theme

Replace the contents of `app/globals.css` with:

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: #0A0A0B;
  --color-foreground: #E4E4E7;
  --color-card: #121214;
  --color-card-foreground: #E4E4E7;
  --color-popover: #121214;
  --color-popover-foreground: #E4E4E7;
  --color-primary: #10b981;
  --color-primary-foreground: #000000;
  --color-secondary: rgba(255, 255, 255, 0.05);
  --color-secondary-foreground: #E4E4E7;
  --color-muted: #18181b;
  --color-muted-foreground: #71717a;
  --color-accent: rgba(255, 255, 255, 0.05);
  --color-accent-foreground: #E4E4E7;
  --color-destructive: #f43f5e;
  --color-destructive-foreground: #ffffff;
  --color-border: rgba(255, 255, 255, 0.05);
  --color-input: rgba(255, 255, 255, 0.1);
  --color-ring: #10b981;
  --color-chart-1: #10b981;
  --color-chart-2: #f43f5e;
  --color-chart-3: #3b82f6;
  --color-chart-4: #f59e0b;
  --color-chart-5: #8b5cf6;
  --radius: 0.75rem;
  --color-sidebar-background: #0A0A0B;
  --color-sidebar-foreground: #E4E4E7;
  --color-sidebar-primary: #10b981;
  --color-sidebar-primary-foreground: #000000;
  --color-sidebar-accent: rgba(255, 255, 255, 0.05);
  --color-sidebar-accent-foreground: #E4E4E7;
  --color-sidebar-border: rgba(255, 255, 255, 0.05);
  --color-sidebar-ring: #10b981;
}

@layer base {
  html {
    font-size: 110%;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
  }
}
```

This uses Tailwind v4's `@theme inline` block (NOT the v3 `theme.extend` in a config file). The colors match the existing dark theme used throughout the app (`#0A0A0B` background, `#121214` cards, emerald-500 primary, rose-500 destructive).

### Step 5: Update `app/layout.tsx`

Replace the contents with:

```tsx
import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexus Terminal',
  description: 'Professional trading journal and performance analytics',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning>
        <SessionProvider>
          {children}
          <Toaster theme="dark" richColors position="bottom-right" />
        </SessionProvider>
      </body>
    </html>
  );
}
```

### Step 6: Create NextAuth Configuration

Create `lib/auth-config.ts`:

```ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    signIn({ user }) {
      const allowed = process.env.ALLOWED_EMAILS;
      if (!allowed) return true; // no allowlist = allow all
      const emails = allowed.split(',').map(e => e.trim().toLowerCase());
      return emails.includes(user.email?.toLowerCase() ?? '');
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.picture = user.image;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.image = token.picture as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/', // redirect to home page, not a separate login page
  },
});
```

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/lib/auth-config';

export const { GET, POST } = handlers;
```

Then **delete** these files (they are replaced by NextAuth):
- `app/api/auth/google/url/route.ts`
- `app/api/auth/google/callback/route.ts`
- `app/api/auth/me/route.ts`
- `app/api/auth/logout/route.ts`
- `lib/auth.ts`

Update `app/page.tsx` to replace the manual auth logic:
- Remove the `user` state, `handleGoogleLogin`, `handleLogout`, and both auth `useEffect` hooks.
- Import `useSession` and `signIn`/`signOut` from `next-auth/react`.
- Use `const { data: session } = useSession()` and reference `session?.user` instead of `user`.
- Replace the Google login button's `onClick` with `() => signIn('google')`.
- Replace the logout button's `onClick` with `() => signOut()`.
- Remove the `window.addEventListener('message', ...)` for `OAUTH_AUTH_SUCCESS`.

### Step 7: Create Turso Database Client

Create `lib/db.ts`:

```ts
import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

export function getDb(): Client | null {
  if (!process.env.TURSO_DATABASE_URL) return null;

  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

export async function initDb() {
  const db = getDb();
  if (!db) return;

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      sort_key TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
      avg_entry_price REAL NOT NULL,
      avg_exit_price REAL NOT NULL,
      total_quantity REAL NOT NULL,
      pnl REAL NOT NULL,
      executions INTEGER NOT NULL DEFAULT 1,
      initial_risk REAL,
      commission REAL DEFAULT 0,
      fees REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trade_tags (
      trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (trade_id, tag)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS schwab_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
```

**Fallback behavior:** If `TURSO_DATABASE_URL` is not set, `getDb()` returns `null`. All API routes must check for this and fall back to returning an error like `{ error: 'Database not configured' }` with status 503. The client-side code should detect this and fall back to localStorage mode (keep the existing localStorage read/write logic behind a conditional).

Create a `lib/storage.ts` abstraction:

```ts
// Returns true if the server database is available.
// Call GET /api/health or similar to check on mount.
// If not, the app falls back to localStorage (existing behavior).
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}
```

Create `app/api/health/route.ts`:

```ts
import { getDb, initDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  if (!db) {
    return Response.json({ db: false }, { status: 503 });
  }
  await initDb(); // idempotent — CREATE IF NOT EXISTS
  return Response.json({ db: true });
}
```

### Step 8: Create API Routes

All routes must:
1. Call `auth()` from `@/lib/auth-config` to get the session.
2. Return 401 if no session.
3. Call `getDb()` — return 503 if null.
4. Scope all queries with `WHERE user_id = ?`.

Create these files:

**`app/api/trades/route.ts`** — GET (list all trades for user), POST (create single trade)

**`app/api/trades/[id]/route.ts`** — PATCH (update fields: notes, initialRisk, tags), DELETE (single trade)

**`app/api/trades/bulk/route.ts`** — POST with body `{ action: 'delete' | 'applyRisk' | 'addTag', ids: string[], value?: number | string }`. Executes the bulk operation in a transaction.

**`app/api/trades/import/route.ts`** — POST with body `{ trades: Trade[] }`. For each trade, use `INSERT INTO trades (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET avg_entry_price=excluded.avg_entry_price, avg_exit_price=excluded.avg_exit_price, total_quantity=excluded.total_quantity, pnl=excluded.pnl, executions=excluded.executions, commission=excluded.commission, fees=excluded.fees` — this preserves existing `notes`, `initial_risk`, and tags.

**`app/api/tags/route.ts`** — GET (list tags for user), POST `{ name: string }` (create), DELETE `{ name: string }` (delete globally — also removes from trade_tags).

For all routes, return JSON. On success, return the affected data so the client can update state without a second fetch.

### Step 9: Update Client-Side Data Flow in `app/page.tsx`

Replace the localStorage read/write pattern:

**On mount:**
1. Check `isDatabaseAvailable()`.
2. If yes: fetch trades from `GET /api/trades` and tags from `GET /api/tags`. Also check if `localStorage` has `nexus-trades` / `nexus-tags` — if so, POST them to `/api/trades/import` and `/api/tags` to migrate, then clear localStorage and show `toast.success("Trades migrated to cloud")`.
3. If no: fall back to existing localStorage logic (keep the current `useEffect` that reads/writes localStorage, guarded by a `const [useLocalStorage, setUseLocalStorage] = useState(true)` flag).

**On mutations** (add trade, delete, apply risk, add/remove tag, etc.):
- If database mode: call the appropriate API route, then update client state from the response.
- If localStorage mode: update state directly (existing behavior).

### Step 10: Update `.env.example`

```env
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=          # Generate with: openssl rand -base64 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Turso Database (optional — app falls back to localStorage if not set)
TURSO_DATABASE_URL=       # e.g., libsql://your-db-name.turso.io
TURSO_AUTH_TOKEN=

# Schwab API (optional — for backtesting data)
SCHWAB_CLIENT_ID=
SCHWAB_CLIENT_SECRET=

# Access Control (optional — comma-separated emails, empty = allow all)
ALLOWED_EMAILS=
```

---

## Bugs & Issues to Fix

After the stack upgrade is complete, fix these issues. **Do not reference line numbers** — find the relevant code by searching for the described content.

### 1. "New Trade" Button Is Non-Functional

**File:** `app/page.tsx` — the `<button>` with text "New Trade" and a `<Plus>` icon in the header.

It renders but has no `onClick` handler.

**Fix:** Create `components/trading/NewTradeDialog.tsx` using shadcn `<Dialog>`, `<Input>`, `<Label>`, and `<Select>`. Use `react-hook-form` with `zodResolver` and a Zod schema:

```ts
const tradeFormSchema = z.object({
  symbol: z.string().min(1).transform(v => v.toUpperCase()),
  direction: z.enum(['LONG', 'SHORT']),
  entryPrice: z.coerce.number().positive(),
  exitPrice: z.coerce.number().positive(),
  quantity: z.coerce.number().int().positive(),
  date: z.string().min(1), // YYYY-MM-DD from date input
  initialRisk: z.coerce.number().positive().optional(),
});
```

On submit: construct a `Trade` object, POST to `/api/trades` (or add to state directly in localStorage mode), close dialog, `toast.success("Trade added")`. Generate the trade `id` as `{sortKey}|{symbol}|{direction}|manual-{Date.now()}`.

Wire the "New Trade" button in `page.tsx` to open this dialog via a `useState<boolean>` controlling the Dialog's `open` prop.

### 2. Schwab OAuth Callback — XSS + No Token Storage

**File:** `app/api/auth/schwab/callback/route.ts`

The callback interpolates `access_token` directly into an inline `<script>` via template literal. This is an XSS vector.

**Fix:**
- Import `auth` from `@/lib/auth-config` and get the session. If no session, redirect to `/`.
- Import `getDb` from `@/lib/db`. Store tokens in the `schwab_tokens` table.
- Replace the Schwab token exchange to use `fetch` instead of `axios` (axios has been uninstalled):
  ```ts
  const tokenResponse = await fetch('https://api.schwab.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, client_id: ..., client_secret: ..., redirect_uri: ..., grant_type: 'authorization_code' }),
  });
  ```
- Return HTML that posts ONLY `{ type: 'SCHWAB_AUTH_SUCCESS' }` to `window.opener` — **no tokens in the HTML or postMessage**.
- On the client, replace `alert('Charles Schwab connected successfully!')` with `toast.success("Charles Schwab connected")`.

### 3. Google OAuth Popup — No Completion Detection

**Resolved by NextAuth migration.** NextAuth uses full-page redirects, not popups. No popup detection needed.

### 4. Session Cookie Breaks Localhost

**Resolved by NextAuth migration.** NextAuth configures cookies correctly per environment.

### 5. "Clear All Filters" Doesn't Reset Date Range

**File:** `app/page.tsx` — find the "Clear All Filters" button's `onClick` handler (it calls `setFilterPreset('all')` and `setSelectedFilterTags(new Set())`).

**Fix:** Add `setStartDate('')` and `setEndDate('')` to the same `onClick`.

### 6. Filters Only Apply on the Filter Tab

**File:** `app/page.tsx` — the `filteredTrades` computation has a guard: `if (activeTab === 'filter') { ... }` that wraps the date/preset/tag filter logic.

**Fix:** Remove the `if (activeTab === 'filter')` guard. Apply date range, preset, and tag filters unconditionally to all views. Add a visible badge in the header when any filter is active — a small emerald pill next to "X TRADES LOGGED" showing "Filtered" with the count, and an X button to clear all filters. Compute `hasActiveFilters` as: `startDate || endDate || filterPreset !== 'all' || selectedFilterTags.size > 0`.

### 7. Daily Performance Chart Shows Per-Trade Bars

**File:** `components/trading/PerformanceCharts.tsx` — the `chartData` reduce that builds one entry per trade.

**Fix:** Replace with daily aggregation using a `Map<string, { date: string; value: number }>`:

```ts
const dailyMap = new Map<string, { date: string; value: number }>();
const sorted = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
sorted.forEach(trade => {
  const key = format(new Date(trade.date), 'yyyy-MM-dd');
  const label = format(new Date(trade.date), 'MM/dd');
  const val = metric === '$' ? trade.pnl : (trade.initialRisk ? trade.pnl / trade.initialRisk : 0);
  const existing = dailyMap.get(key);
  dailyMap.set(key, { date: label, value: (existing?.value ?? 0) + val });
});

let cumulative = 0;
const chartData = Array.from(dailyMap.values()).map(d => {
  cumulative += d.value;
  return { ...d, cumulative };
});
```

### 8. Remove Unused `rMultiple` Field

**File:** `lib/types.ts` — the `Trade` interface has `rMultiple?: number`.

**Fix:** Remove this field. The R-multiple is always computed inline as `trade.pnl / trade.initialRisk`.

### 9. Trade Notes Have No UI

**File:** `lib/types.ts` has `notes?: string` on `Trade`, but no UI exists to edit it.

**Fix:** Create `components/trading/TradeDetailSheet.tsx` using shadcn `<Sheet>`. Opens when a user clicks a trade row (not in readOnly mode). Shows: full trade details (symbol, direction, date, entry/exit prices, quantity, PnL, risk, R-multiple, commission, fees) + a `<textarea>` for notes. On save, PATCH `/api/trades/[id]` with updated notes (or update state directly in localStorage mode). Show `toast.success("Notes saved")`.

In `TradeTable.tsx`, add an `onTradeClick` prop and call it on row click. In `page.tsx`, manage a `selectedTradeId` state that controls the sheet.

### 10. Double localStorage Write in handleDeleteSelected

**File:** `app/page.tsx` — `handleDeleteSelected` calls `localStorage.setItem` directly inside `setTrades`, but a `useEffect` already persists trades on every change.

**Fix:** In database mode, this is eliminated (call the bulk delete API route instead). In localStorage fallback mode, remove the manual `localStorage.setItem` from `handleDeleteSelected` and let the `useEffect` handle it.

### 11. Search Query Resets on Tab Change

**File:** `app/page.tsx` — `handleTabChange` calls `setSearchQuery('')`.

**Fix:** Remove `setSearchQuery('')` from `handleTabChange`.

### 12. Sidebar Icons Are Non-Functional

**File:** `app/page.tsx` — Bell, Settings, and User icons in the sidebar nav.

**Fix:**
- **Settings:** Create `components/trading/SettingsMenu.tsx` using shadcn `<DropdownMenu>`. Items: "Export Trades (JSON)" — triggers download of all trades as JSON. "Export Trades (CSV)" — triggers download as CSV. "Clear All Data" — shadcn `<Dialog>` confirmation, then deletes all trades + tags. Wire the Settings `<icon>` to trigger this dropdown.
- **User:** Use shadcn `<DropdownMenu>`. If authenticated: show user name, email, "Sign Out" button. If not: show "Sign In" button.
- **Bell:** Wrap in `<button onClick={() => toast("No new notifications")}>`.

### 13. CSV Parser Ignores Commissions and Fees

**File:** `lib/csv-parser.ts` — the `data.forEach` loop and the trade matching logic.

**Fix:** Parse commission and fees from each CSV row:
```ts
const commission = parsePrice(row.Commission || row.Comm) || 0;
const fees = parsePrice(row.Fees || row.Fee) || 0;
```

Add these to the `RawExecution` interface. Accumulate them per matched pair and subtract from PnL. Add `commission?: number` and `fees?: number` fields to the `Trade` interface in `lib/types.ts`. Store the totals in the merged trade object. Display them in the TradeDetailSheet.

### 14. CSV Re-Import Destroys User Metadata

**File:** `app/page.tsx` — `handleFileUpload` filters out existing trades by `sortKey` and replaces them.

**Fix:** In database mode: send parsed trades to `POST /api/trades/import` which uses `INSERT ... ON CONFLICT(id) DO UPDATE` to preserve `initial_risk`, `notes`, and tags while updating price/PnL data.

In localStorage fallback mode: before replacing, build a map of existing trade metadata by `id`:
```ts
const existingMeta = new Map(prev.filter(t => processedDates.has(t.sortKey)).map(t => [t.id, { tags: t.tags, notes: t.notes, initialRisk: t.initialRisk }]));
```
After parsing new trades, merge the preserved metadata back onto matching trade IDs.

### 15. No Empty State for Dashboard

**File:** `app/page.tsx` — the `activeTab === 'dashboard'` block shows metrics and charts even with zero trades.

**Fix:** When `trades.length === 0`, render a welcome/onboarding card instead:
- Heading: "Welcome to Nexus Terminal"
- Subtext: "Import your trading data to get started"
- A file upload button (reuse the existing `handleFileUpload` logic)
- A note: "CSV files should be named like `01-15-25.csv` (MM-DD-YY)"
- A secondary button: "Or add a trade manually" → opens NewTradeDialog

Style it centered within the dashboard area, using the existing card style (`bg-[#121214] border border-white/5 rounded-2xl`).

### 16. Charts Show Nothing with Zero Trades

**File:** `components/trading/PerformanceCharts.tsx`

**Fix:** At the top of the component, if `trades.length === 0`, return:
```tsx
<div className="bg-[#121214] border border-white/5 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
  <BarChart3 className="w-12 h-12 text-zinc-700 mb-4" />
  <p className="text-zinc-500 text-sm">Import trades to see performance analytics</p>
</div>
```
Import `BarChart3` from `lucide-react`.

### 17. Unused Environment Variables

**Fix:** Already handled — the new `.env.example` in Step 10 removes `GEMINI_API_KEY`, `NEXT_PUBLIC_GEMINI_API_KEY`, `JWT_SECRET`, and `APP_URL`.

### 18. Tag Dropdown Overflows Off-Screen

**File:** `components/trading/TradeTable.tsx` — the tag input dropdown positioned with `absolute left-0 top-0`.

**Fix:** Replace the entire hand-rolled tag dropdown with shadcn `<Popover>` + `<Command>`:
- `<PopoverTrigger>` is the `+` button.
- `<PopoverContent>` contains a `<Command>` with: a `<CommandInput>` for searching/creating tags, a `<CommandList>` of existing global tags (filtered to exclude already-applied tags), and a `<CommandEmpty>` that shows "Press Enter to create '{query}'".
- On select, call `onAddTag(trade.id, tagName)`.
- This eliminates the fixed backdrop overlay (`<div className="fixed inset-0 z-40" ...>`) — Popover handles outside clicks natively.

---

## Implementation Notes

- **Preserve the dark theme.** All existing inline colors (`bg-[#0A0A0B]`, `bg-[#121214]`, `border-white/5`, `text-emerald-500`, `text-rose-500`) should remain. New shadcn components will inherit from the CSS variables defined in `globals.css`.
- **TypeScript:** No `any` in new code. Use proper types everywhere.
- **Imports:** Use `@/` path aliases (already configured in tsconfig).
- **Sonner toasts:** Use `toast.success()` for confirmations, `toast.error()` for failures, `toast()` for neutral info.
- **API error handling:** All `fetch` calls to API routes should check `res.ok` and show `toast.error(data.error || 'Something went wrong')` on failure.
- **Keep `lib/env.ts`** — it's still used for the Schwab OAuth redirect URI.
- **Keep `hooks/use-mobile.ts`** — it may be needed for responsive layouts.

## Priority Order

Execute in this order:

1. **Steps 1–3:** Install deps, remove unused packages, create `components.json`
2. **Step 4:** Update `globals.css` with theme variables
3. **Steps 5–6:** Update layout, create NextAuth config + route (fixes #3, #4)
4. **Steps 7–8:** Create Turso client, API routes, health check (fixes #10)
5. **Step 9:** Update `page.tsx` data flow (localStorage → API with fallback)
6. **Step 10:** Update `.env.example` (fixes #17)
7. **#2:** Schwab callback XSS + token storage
8. **#14:** CSV re-import preserves metadata
9. **#7:** Daily chart aggregation
10. **#5:** Clear All Filters fix
11. **#6:** Filters apply globally
12. **#1:** New Trade dialog
13. **#9:** Trade notes sheet
14. **#13:** CSV commission/fees
15. **#15:** Dashboard empty state
16. **#16:** Charts empty state
17. **#18:** Tag dropdown → shadcn Popover/Command
18. **#11:** Search persistence across tabs
19. **#12:** Sidebar icons wired up
20. **#8:** Remove unused rMultiple field
