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
