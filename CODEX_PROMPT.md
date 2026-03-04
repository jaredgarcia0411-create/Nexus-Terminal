# Nexus Terminal — Implementation Plan

## Overview

Nexus Terminal is a Next.js 15 trading journal app with PostgreSQL (Neon) cloud persistence via Drizzle ORM, NextAuth v5 Google OAuth, and a dark theme built on shadcn/ui. The app is functional for core trade management with completed login flow, component decomposition, backtesting integration, broker sync, and database migration. The remaining work focuses on UI/UX hardening, accessibility, responsiveness, and service-layer completions.

This document describes **3 active workstreams** in priority order. Workstreams 1-6 from the previous plan are **completed** and archived at the bottom for reference. Each active section includes the exact files to create/modify, the behavior expected, and implementation constraints.

---

## Completed Workstreams (Archived)

The following workstreams are done and should not be re-executed:

1. **Custom Login Page + Middleware** — `app/login/page.tsx`, `middleware.ts`, `lib/auth-config.ts` all exist and function correctly. The app gates all routes behind Google OAuth.
2. **Refactor `app/page.tsx`** — Decomposed into `hooks/use-trades.ts`, `components/trading/Sidebar.tsx`, `components/trading/Toolbar.tsx`, `DashboardTab.tsx`, `JournalTab.tsx`, `PerformanceTab.tsx`, `FilterTab.tsx`, `BacktestingTab.tsx`, `BrokerSyncTab.tsx`. `app/page.tsx` is now ~220 lines composing these components.
3. **Build Out the Backtesting Tab** — Fully functional with Schwab market data fetching, CandlestickChart (lightweight-charts), technical indicators, strategy selection, client-side backtest engine, and results panel.
4. **Bug Fixes & Polish** — CSV parser returns `warnings` array. `firebase-tools` removed. Schwab OAuth env validation added.
5. **Database Migration (Turso to PostgreSQL/Neon/Drizzle)** — Complete. Schema in `lib/db/schema.ts`, dual HTTP+Pool clients in `lib/db.ts`, all API routes use Drizzle query builder. `@libsql/client` removed.
6. **Code Review Hardening Sprint** — Tenant-safe composite keys, Schwab OAuth state validation, Discord/backtest contract reconciliation all done.

---

## 7. UI/UX Hardening

### Objective

Address critical usability bugs, accessibility gaps, and responsiveness failures identified in the 2026-03-03 UI/UX audit. This workstream consolidates 20 findings across critical, warning, and suggestion severity levels.

### Current State

The app is functionally complete but has several UI/UX issues:
- Destructive actions lack confirmation dialogs
- Trade detail sheet loses existing notes
- No mobile/responsive behavior despite the existence of `useIsMobile()` hook
- Accessibility gaps: missing ARIA labels, inadequate focus states, no reduced-motion support
- Inconsistent component usage (raw `<button>` and `<select>` instead of shadcn equivalents)
- Multiple `any` types in chart formatters
- Dead features confusing users

### Required Changes

#### Change 7.1: Add Confirmation Dialog for Delete Selected (CRITICAL)

**File:** `components/trading/Toolbar.tsx`
**Action:** MODIFY
**Complexity:** LOW

The "Delete Selected" button (line 86-92) triggers `onDeleteSelected()` directly with no confirmation. This parallels the "Clear All Data" flow in `components/trading/SettingsMenu.tsx` which correctly uses a `Dialog` component for confirmation.

**Implementation:**
- Import `{ useState }` from react
- Import `{ Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle }` from `@/components/ui/dialog`
- Import `{ Button }` from `@/components/ui/button`
- Add `const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)` state
- Change the delete button's `onClick` to `() => setConfirmDeleteOpen(true)` instead of `onDeleteSelected`
- Add a `<Dialog>` after the `</header>` element (inside a fragment) with:
  - Title: "Delete selected trades?"
  - Body: `{selectedCount} trade(s) will be permanently deleted. This action cannot be undone.`
  - Cancel button: `<Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>`
  - Confirm button: `<Button onClick={() => { onDeleteSelected(); setConfirmDeleteOpen(false); }} className="bg-rose-500 hover:bg-rose-400 text-white">Delete</Button>`
- Wrap the component return in a fragment (`<>...</>`) to include the Dialog alongside the header

**Reference pattern:** See `components/trading/SettingsMenu.tsx` lines 112-133 for the exact Dialog usage pattern.

**Acceptance Criteria:**
- [ ] Clicking "Delete Selected" in the toolbar opens a confirmation dialog
- [ ] The dialog shows the count of trades to be deleted
- [ ] Clicking "Cancel" closes the dialog without deleting
- [ ] Clicking "Delete" calls `onDeleteSelected()` and closes the dialog
- [ ] Visual styling matches the existing SettingsMenu confirmation dialog

#### Change 7.2: Fix TradeDetailSheet Notes Initialization (CRITICAL)

**File:** `components/trading/TradeDetailSheet.tsx`
**Action:** MODIFY
**Complexity:** LOW

The `notes` state initializes to `''` (line 21) and never reads from `trade.notes`. When a user opens a trade that already has notes, they see an empty textarea. Saving would overwrite existing notes with blank text.

**Implementation:**
- Import `{ useEffect }` from react (add to existing import)
- Change line 21 from `const [notes, setNotes] = useState('');` to `const [notes, setNotes] = useState(trade?.notes ?? '');`
- Add a `useEffect` to sync notes when the trade prop changes:
  ```typescript
  useEffect(() => {
    setNotes(trade?.notes ?? '');
  }, [trade]);
  ```

**Acceptance Criteria:**
- [ ] Opening a trade with existing notes shows those notes in the textarea
- [ ] Opening a trade with no notes shows an empty textarea
- [ ] Switching between trades (via prop change) updates the textarea content
- [ ] Saving notes still works correctly

#### Change 7.3: Make Sidebar Responsive (CRITICAL)

**File:** `components/trading/Sidebar.tsx`
**Action:** MODIFY
**File:** `app/page.tsx`
**Action:** MODIFY
**Complexity:** MEDIUM

The sidebar is `fixed left-0 w-16` and `main` has `pl-16` (app/page.tsx line 91). On screens < 768px the sidebar takes 64px of a small viewport with no collapse or drawer behavior. The `useIsMobile()` hook exists at `hooks/use-mobile.ts` (breakpoint 768px) but is never used.

**Implementation for `components/trading/Sidebar.tsx`:**
- Import `{ useIsMobile }` from `@/hooks/use-mobile`
- Add `const isMobile = useIsMobile();`
- Desktop (not mobile): Keep existing layout unchanged — `fixed left-0 top-0 z-50 flex h-full w-16 flex-col`
- Mobile: Render as a fixed bottom navigation bar:
  - `fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t border-white/5 bg-[#0A0A0B] px-2`
  - Show only the 6 nav icons in a horizontal row (no logo, no settings menu, no user menu on the bottom bar)
  - Move SettingsMenu and User dropdown into a "more" menu or keep them accessible from the Toolbar on mobile

**Implementation for `app/page.tsx`:**
- Import `{ useIsMobile }` from `@/hooks/use-mobile`
- Add `const isMobile = useIsMobile();`
- Change `<main className="pl-16">` to `<main className={isMobile ? 'pb-16' : 'pl-16'}>`
  - On mobile: bottom padding instead of left padding (bottom nav instead of sidebar)

**Acceptance Criteria:**
- [ ] On screens >= 768px: sidebar displays as the existing left column
- [ ] On screens < 768px: sidebar displays as a bottom navigation bar
- [ ] The main content area adjusts its padding accordingly
- [ ] All 6 navigation tabs are accessible on mobile
- [ ] User menu / settings remain accessible on mobile (via toolbar or collapsed menu)

#### Change 7.4: Make Toolbar Responsive (CRITICAL)

**File:** `components/trading/Toolbar.tsx`
**Action:** MODIFY
**Complexity:** MEDIUM

The toolbar uses `flex justify-between` (line 39) with no wrapping. On narrow viewports the left side (title + badge + mode label) and right side (user info + buttons) will overlap or overflow.

**Implementation:**
- Import `{ useIsMobile }` from `@/hooks/use-mobile`
- Add `const isMobile = useIsMobile();`
- On mobile:
  - Hide the user info section (name/email/avatar block, lines 66-81) — users have the sign-out option in the sidebar/bottom nav
  - Hide the "Local Storage Mode" / "Cloud Mode" label (line 56)
  - Simplify to: app title + trade count badge on the left, action buttons on the right
  - If `selectedCount > 0`, show the delete button inline with the action buttons
  - Wrap the toolbar items with `flex-wrap gap-2` to prevent overflow
- On desktop: keep existing layout unchanged

**Acceptance Criteria:**
- [ ] Toolbar does not overflow on screens < 768px
- [ ] Import and New Trade buttons remain accessible on mobile
- [ ] Selected count and delete button remain accessible when trades are selected
- [ ] No visual regression on desktop

#### Change 7.5: Add aria-label to Sidebar Buttons (WARNING)

**File:** `components/trading/Sidebar.tsx`
**Action:** MODIFY
**Complexity:** LOW

All 6 sidebar nav buttons (lines 37-78) use only `title` attribute for labeling. Screen readers need `aria-label` since the buttons contain only icons (no visible text).

**Implementation:**
- Add `aria-label` matching the existing `title` to every sidebar icon button:
  - `aria-label="Dashboard"` (line 40)
  - `aria-label="Performance"` (line 46)
  - `aria-label="Journal"` (line 52)
  - `aria-label="Filter"` (line 58)
  - `aria-label="Backtesting"` (line 64)
  - `aria-label="Broker Sync"` (line 70)
- Also add `aria-label="Settings"` to the SettingsMenu trigger button and `aria-label="User Menu"` to the User dropdown trigger

**Acceptance Criteria:**
- [ ] Every icon-only button in the sidebar has an `aria-label`
- [ ] The `aria-label` values match the `title` values
- [ ] No visual changes

#### Change 7.6: Add Visible Focus States (WARNING)

**Files to modify:**
- `components/trading/JournalTab.tsx` (line 60)
- `components/trading/FilterTab.tsx` (lines 61-63)
- `components/trading/BacktestingTab.tsx` (lines 267, 396-428)
- `components/trading/BrokerSyncTab.tsx` (lines 132-156)

**Action:** MODIFY (all files)
**Complexity:** LOW

All raw `<input>` and `<select>` elements use `focus:outline-none` with only `focus:border-emerald-500/50` as a replacement. The border color change alone is insufficient for WCAG 2.1 SC 1.4.11 (non-text contrast) against the dark background.

**Implementation:**
- Find every instance of `focus:outline-none` in these files
- Replace with: `focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]`
- This applies to:
  - `JournalTab.tsx`: search input (line 60), risk input (line 74)
  - `FilterTab.tsx`: date inputs (lines 61-63)
  - `BacktestingTab.tsx`: symbol search input (line 267), strategy select (line 385), capital input (line 400), position size input (line 412), parameter inputs (line 428)
  - `BrokerSyncTab.tsx`: account select (line 132), start date input (line 147), end date input (line 155)

**Acceptance Criteria:**
- [ ] All interactive inputs show a visible emerald ring on focus
- [ ] The ring is clearly visible against the `#121214` background
- [ ] `focus:outline-none` is preserved (browser default outline removed)
- [ ] No visual changes when elements are not focused

#### Change 7.7: Bundle Google SVG Locally (WARNING)

**File:** `app/login/page.tsx`
**Action:** MODIFY
**New file:** `public/google.svg`
**Action:** CREATE
**Complexity:** LOW

The Google icon loads from `https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg` (line 31). If this CDN is unavailable, the login button renders with a broken image.

**Implementation:**
- Create `public/google.svg` with the standard Google "G" logo SVG content:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>
```
- In `app/login/page.tsx`, change the `Image` src from the external URL to `/google.svg`
- Remove the `www.gstatic.com` entry from `next.config.ts` `images.remotePatterns` if it exists

**Acceptance Criteria:**
- [ ] `public/google.svg` exists with the Google "G" logo
- [ ] Login page renders the Google icon from the local file
- [ ] No external CDN dependency for the login button icon

#### Change 7.8: Respect prefers-reduced-motion (WARNING)

**File:** `app/layout.tsx`
**Action:** MODIFY
**Complexity:** LOW

All components using `motion.div` apply entrance/exit animations but never check `prefers-reduced-motion`.

**Implementation:**
- The `motion` library (motion/react v12) supports a global `MotionConfig` component with a `reducedMotion` prop
- In `app/layout.tsx`, wrap the children with:
  ```tsx
  import { MotionConfig } from 'motion/react';

  // Inside the body:
  <MotionConfig reducedMotion="user">
    {children}
  </MotionConfig>
  ```
- This causes all `motion.div` instances to respect the user's OS-level `prefers-reduced-motion` setting
- No changes needed to individual components

**Acceptance Criteria:**
- [ ] `MotionConfig` with `reducedMotion="user"` wraps the app in `app/layout.tsx`
- [ ] When the OS has `prefers-reduced-motion: reduce` enabled, animations are suppressed
- [ ] No visual changes for users who have not enabled reduced motion

#### Change 7.9: Remove Sign-Out from Avatar Click (WARNING)

**File:** `components/trading/Toolbar.tsx`
**Action:** MODIFY
**Complexity:** LOW

Clicking the user avatar (lines 71-80) triggers `onSignOut`. There is no visual indication this is a sign-out action — it looks like a profile image. The red dot on hover is subtle and non-discoverable. Users already have an explicit "Sign Out" option in the sidebar user dropdown.

**Implementation:**
- Remove the `onClick={onSignOut}` from the avatar button (line 71)
- Remove the red dot indicator div (line 79)
- Make the avatar non-interactive: change from `<button>` to a `<div>`
- Remove `onSignOut` prop from `ToolbarProps` interface and the Toolbar component if no other element uses it
- In `app/page.tsx`, remove the `onSignOut={handleSignOut}` prop from the `<Toolbar>` invocation

**Acceptance Criteria:**
- [ ] Clicking the user avatar in the toolbar does nothing
- [ ] The red dot on hover is removed
- [ ] Sign-out is still accessible via the sidebar user dropdown
- [ ] No TypeScript errors from removing the unused prop

#### Change 7.10: Replace Raw select with shadcn Select (WARNING)

**Files:**
- `components/trading/BacktestingTab.tsx` (lines 382-389)
- `components/trading/BrokerSyncTab.tsx` (lines 129-139)

**Action:** MODIFY (both files)
**Complexity:** MEDIUM

Raw `<select>` elements with `bg-white/5` render `<option>` elements with browser-default white backgrounds on Chrome/Firefox, creating unreadable text. The shadcn `Select` component already exists and is used in `NewTradeDialog`.

**Implementation for `BacktestingTab.tsx`:**
- Import `{ Select, SelectContent, SelectItem, SelectTrigger, SelectValue }` from `@/components/ui/select`
- Replace the raw `<select>` for strategy selection with:
  ```tsx
  <Select value={selectedStrategy.id} onValueChange={handleStrategyChange}>
    <SelectTrigger className="w-full border-white/10 bg-white/5">
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="border-white/10 bg-[#121214]">
      {ALL_STRATEGIES.map((s) => (
        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
  ```

**Implementation for `BrokerSyncTab.tsx`:**
- Same pattern for account selection

**Acceptance Criteria:**
- [ ] Both `<select>` elements replaced with shadcn `<Select>`
- [ ] Dropdown options render with the dark theme background
- [ ] Value selection still works correctly

#### Change 7.11: Memoize Dashboard Stats (WARNING)

**File:** `components/trading/DashboardTab.tsx`
**Action:** MODIFY
**Complexity:** LOW

Total PnL, Win Rate, and Profit Factor are computed inline (lines 69-88) with `.reduce()` and `.filter()` calls directly in JSX. These recalculate on every render.

**Implementation:**
- Import `{ useMemo }` from react
- Extract the three computations into a single `useMemo`:
  ```typescript
  const stats = useMemo(() => {
    const totalPnl = trades.reduce((acc, trade) => acc + trade.pnl, 0);
    const winRate = trades.length > 0
      ? (trades.filter((trade) => trade.pnl > 0).length / trades.length) * 100
      : 0;
    const wins = trades.filter((trade) => trade.pnl > 0).reduce((acc, trade) => acc + trade.pnl, 0);
    const losses = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((acc, trade) => acc + trade.pnl, 0));
    const profitFactor = losses === 0 ? (wins > 0 ? Infinity : 0) : wins / losses;
    return { totalPnl, winRate, profitFactor };
  }, [trades]);
  ```
- Reference `stats.totalPnl`, `stats.winRate`, `stats.profitFactor` in JSX

**Acceptance Criteria:**
- [ ] Stats are computed via `useMemo` with `[trades]` dependency
- [ ] No inline `.reduce()` or `.filter()` calls remain in the JSX
- [ ] Displayed values are identical to before

#### Change 7.12: Fix TradeTable Empty State colspan (WARNING)

**File:** `components/trading/TradeTable.tsx`
**Action:** MODIFY
**Complexity:** LOW

The empty state row (line 197) uses `colSpan={readOnly ? 11 : 12}`, but the table has:
- When `readOnly` is true: 10 columns (Date, Symbol, Side, Tags, Notes, Avg Entry, Avg Exit, Qty, Risk, PnL)
- When `readOnly` is false: 11 columns (checkbox + the same 10)

**Implementation:**
- Change line 197 from `colSpan={readOnly ? 11 : 12}` to `colSpan={readOnly ? 10 : 11}`

**Acceptance Criteria:**
- [ ] Empty state message spans the full width of the table in both modes
- [ ] No visual misalignment

#### Change 7.13: Add ARIA to Import Loading Overlay (SUGGESTION)

**File:** `app/page.tsx`
**Action:** MODIFY
**Complexity:** LOW

The import loading overlay (lines 211-218) has no ARIA attributes. Screen readers won't announce the loading state.

**Implementation:**
- Add `role="alertdialog"` and `aria-label="Processing trade data"` to the outer overlay div (line 212)
- Add `aria-live="assertive"` to the text element

**Acceptance Criteria:**
- [ ] The import overlay has `role="alertdialog"` and `aria-label`
- [ ] Screen readers announce the loading state

#### Change 7.14: Make TradingCalendar Responsive (SUGGESTION)

**File:** `components/trading/TradingCalendar.tsx`
**Action:** MODIFY
**Complexity:** MEDIUM

The calendar uses `grid-cols-8` (line 109) with `min-h-[100px]` cells. On mobile screens this creates horizontal overflow.

**Implementation:**
- Import `{ useIsMobile }` from `@/hooks/use-mobile`
- On mobile (< 768px):
  - Hide the "Weekly" summary column: use `grid-cols-7` instead of `grid-cols-8`
  - Remove the weekly summary cells from the grid
  - Reduce cell minimum height: `min-h-[60px]` on mobile
  - Reduce font sizes within cells
- On desktop: keep existing `grid-cols-8` layout unchanged

**Acceptance Criteria:**
- [ ] Calendar does not horizontally overflow on mobile screens
- [ ] Weekly summary column is hidden on mobile
- [ ] Calendar remains fully functional on desktop

#### Change 7.15: Make Backtesting Strategy Grid Responsive (SUGGESTION)

**File:** `components/trading/BacktestingTab.tsx`
**Action:** MODIFY
**Complexity:** LOW

The strategy parameter grid (line 379) uses hardcoded `grid-cols-4` which makes inputs unusably narrow on smaller screens.

**Implementation:**
- Change `grid-cols-4` to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`

**Acceptance Criteria:**
- [ ] Strategy parameters stack into fewer columns on smaller screens
- [ ] Inputs remain usable at all viewport widths

#### Change 7.16: Type PerformanceCharts Tooltip Formatters (SUGGESTION)

**File:** `components/trading/PerformanceCharts.tsx`
**Action:** MODIFY
**Complexity:** LOW

Multiple tooltip `formatter` callbacks use `(value: any)` (lines 134, 172, 209, 244) and `.map((entry: any)` (lines 175, 212, 247), bypassing TypeScript safety.

**Implementation:**
- Replace `(value: any)` with `(value: number)` in all formatter callbacks
- Replace `(entry: any, index: number)` with proper types derived from the chart data arrays

**Acceptance Criteria:**
- [ ] No `any` types remain in PerformanceCharts.tsx
- [ ] `npm run build` passes without TypeScript errors
- [ ] Chart tooltips still render correctly

#### Change 7.17: Add ResizeObserver to CandlestickChart (SUGGESTION)

**File:** `components/trading/CandlestickChart.tsx`
**Action:** MODIFY
**Complexity:** LOW

Chart resize only listens to `window.resize` events (line 116). Container resizes (e.g., from sidebar toggle on mobile) won't trigger a resize.

**Implementation:**
- Replace the `window.addEventListener('resize', handleResize)` block with a `ResizeObserver`:
  ```typescript
  const resizeObserver = new ResizeObserver(() => {
    if (containerRef.current && chartRef.current) {
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    }
  });
  if (containerRef.current) {
    resizeObserver.observe(containerRef.current);
  }

  return () => {
    resizeObserver.disconnect();
    // ... existing cleanup
  };
  ```

**Acceptance Criteria:**
- [ ] Chart resizes when its container changes size (not just on window resize)
- [ ] No memory leaks (observer disconnected on cleanup)
- [ ] `window.resize` listener is removed

#### Change 7.18: Clarify or Remove Context Files Area (SUGGESTION)

**File:** `components/trading/BacktestingTab.tsx`
**Action:** MODIFY
**Complexity:** LOW

The "Add context files" upload area (lines 278-301) accepts files but stores them in local state that is never consumed. This is a dead feature that could confuse users.

**Implementation:**
- Add a "Coming soon" badge above the upload area
- Disable the file input by adding `disabled` attribute
- Change cursor from `cursor-pointer` to `cursor-not-allowed`
- Add a small description text: "Upload CSV, JSON, or TXT files for AI-assisted analysis (not yet functional)"

**Acceptance Criteria:**
- [ ] Context file upload area shows a "Coming soon" badge
- [ ] File input is disabled (cannot upload)
- [ ] Users understand the feature is planned but not yet available

#### Change 7.19: Add Empty State for Broker Accounts (SUGGESTION)

**File:** `components/trading/BrokerSyncTab.tsx`
**Action:** MODIFY
**Complexity:** LOW

If the `accounts` array is empty after connecting to Schwab (edge case), the `<Select>` renders with no options and the sync button is disabled with no explanation.

**Implementation:**
- Add a conditional check before the account Select:
  ```tsx
  {accounts.length === 0 && connected ? (
    <p className="text-xs text-yellow-400">No accounts found. Check your Schwab connection.</p>
  ) : (
    // existing Select component
  )}
  ```

**Acceptance Criteria:**
- [ ] When connected but accounts array is empty, a helpful message is displayed
- [ ] When accounts exist, the Select renders normally

#### Change 7.20: Replace Raw Buttons with shadcn Button (SUGGESTION)

**Files:**
- `components/trading/DashboardTab.tsx` (lines 49-54, 59)
- `components/trading/Toolbar.tsx` (lines 98-104)
- `components/trading/FilterTab.tsx` (lines 76-87)

**Action:** MODIFY (all files)
**Complexity:** LOW

Multiple components use raw `<button>` with custom Tailwind classes instead of the shadcn `Button` component. This creates styling inconsistency.

**Implementation:**
- Import `{ Button }` from `@/components/ui/button` in each file
- Replace primary action buttons (the emerald CTA buttons) with `<Button>` using appropriate variants
- Keep icon-only buttons (sidebar nav) as raw buttons since they have custom toggle styling

**Acceptance Criteria:**
- [ ] Primary action buttons use the shadcn `Button` component
- [ ] Visual appearance is consistent with existing buttons that already use shadcn
- [ ] No functional changes

---

### Files Summary for Workstream 7

#### New Files to Create
| File | Purpose |
|------|---------|
| `public/google.svg` | Local Google "G" logo SVG for login page |

#### Files to Modify
| # | File | Risk | Changes |
|---|------|------|---------|
| 1 | `components/trading/Toolbar.tsx` | MEDIUM | Add delete confirmation dialog (7.1), responsive layout (7.4), remove avatar sign-out (7.9), use shadcn Button (7.20) |
| 2 | `components/trading/TradeDetailSheet.tsx` | LOW | Initialize notes from trade prop (7.2) |
| 3 | `components/trading/Sidebar.tsx` | MEDIUM | Mobile bottom nav (7.3), add aria-labels (7.5) |
| 4 | `app/page.tsx` | LOW | Responsive padding (7.3), ARIA on import overlay (7.13) |
| 5 | `components/trading/JournalTab.tsx` | LOW | Focus ring styles (7.6) |
| 6 | `components/trading/FilterTab.tsx` | LOW | Focus ring styles (7.6), use shadcn Button (7.20) |
| 7 | `components/trading/BacktestingTab.tsx` | LOW | Focus ring styles (7.6), shadcn Select (7.10), responsive grid (7.15), context files badge (7.18) |
| 8 | `components/trading/BrokerSyncTab.tsx` | LOW | Focus ring styles (7.6), shadcn Select (7.10), empty accounts state (7.19) |
| 9 | `app/login/page.tsx` | LOW | Local Google SVG (7.7) |
| 10 | `app/layout.tsx` | LOW | MotionConfig reduced motion (7.8) |
| 11 | `components/trading/DashboardTab.tsx` | LOW | Memoize stats (7.11), use shadcn Button (7.20) |
| 12 | `components/trading/TradeTable.tsx` | LOW | Fix colspan (7.12) |
| 13 | `components/trading/PerformanceCharts.tsx` | LOW | Type formatters (7.16) |
| 14 | `components/trading/CandlestickChart.tsx` | LOW | ResizeObserver (7.17) |
| 15 | `components/trading/TradingCalendar.tsx` | MEDIUM | Responsive grid (7.14) |
| 16 | `next.config.ts` | LOW | Remove gstatic.com from remotePatterns (7.7) |

### Testing Requirements

- [ ] `npm run build` completes with zero TypeScript errors
- [ ] `npm run lint` passes
- [ ] `npm test` passes (existing vitest suite)
- [ ] Delete Selected shows confirmation dialog before deleting
- [ ] TradeDetailSheet shows existing notes when opening a trade
- [ ] Sidebar renders as bottom nav on mobile (< 768px)
- [ ] Toolbar does not overflow on mobile
- [ ] All sidebar buttons have aria-label attributes
- [ ] All form inputs show visible focus ring on Tab navigation
- [ ] Login page Google icon loads from local SVG
- [ ] Animations are suppressed when OS prefers-reduced-motion is enabled
- [ ] Avatar click in toolbar does not trigger sign-out
- [ ] Strategy and account selects render with dark theme dropdown options
- [ ] Dashboard stats do not recompute when unrelated state changes
- [ ] Empty trade table colspan spans correctly
- [ ] Candlestick chart resizes on container resize (not just window resize)

### Rollback Plan

1. `git stash` or `git checkout .` to revert all changes
2. No database changes in this workstream
3. All changes are frontend-only and can be reverted independently

### Security Considerations

1. **No new API surface** — this workstream is purely frontend
2. **Sign-out path preserved** — removing avatar sign-out still leaves the sidebar dropdown sign-out intact
3. **Local SVG** — eliminates an external CDN dependency, reducing attack surface

---

## 8. Service Layer Completions

### Objective

Close the gaps identified in the hardening sprint handoff document. These are service-level tasks that require implementing missing functionality in the Discord bot, background workers, and webhook infrastructure.

### Current State

Per `HANDOFF.md` (2026-03-04), the following remain incomplete:

1. **Discord onboarding gap** — Bot calls require an existing `discord_user_links` mapping, but there is no bot-side self-serve linking command.
2. **Webhook delivery stub** — `/api/webhooks/trade-event` validates input but does not forward events.
3. **Price alert evaluation** — Alert creation and storage works, but no background evaluator triggers alerts on live price conditions.
4. **Backtest worker strategy parity** — Python worker implements only `sma-crossover`; `mean-reversion` and `breakout` are pending.

### Required Changes

#### Change 8.1: Discord `/link` Onboarding Command

**File:** `services/discord-bot/src/commands/link.ts`
**Action:** CREATE
**Complexity:** HIGH

Implement a `/link` slash command that generates a one-time linking code, prompts the user to enter it in the Nexus Terminal web UI (or vice versa), and creates a `discord_user_links` row via the `/api/discord/link` route.

**Acceptance Criteria:**
- [ ] `/link` command generates a unique code
- [ ] User can link their Discord identity to their Nexus Terminal account
- [ ] Duplicate linking attempts are handled gracefully
- [ ] The linking is stored in `discord_user_links` table

#### Change 8.2: Webhook Event Forwarding

**File:** `app/api/webhooks/trade-event/route.ts`
**Action:** MODIFY
**Complexity:** MEDIUM

Implement actual event forwarding to Discord (via bot webhook or direct API call) when trade events occur.

**Acceptance Criteria:**
- [ ] Trade events are forwarded to the user's linked Discord channel
- [ ] Events without a linked Discord user are silently dropped (no error)
- [ ] Rate limiting prevents spam

#### Change 8.3: Price Alert Evaluation

**New files in services or as a cron/scheduled function**
**Action:** CREATE
**Complexity:** HIGH

Implement a background process that periodically checks market prices against stored `price_alerts` and triggers notifications.

**Acceptance Criteria:**
- [ ] Active (non-triggered) alerts are evaluated on a schedule
- [ ] When price conditions are met, the alert is marked as triggered
- [ ] A notification is sent (Discord or in-app)

#### Change 8.4: Backtest Worker Strategy Parity

**File:** `services/backtest-worker/` (Python)
**Action:** MODIFY
**Complexity:** MEDIUM

Implement `mean-reversion` and `breakout` strategies in the Python backtest worker to match the client-side strategy definitions in `lib/backtesting/strategies.ts`.

**Acceptance Criteria:**
- [ ] Python worker supports all three strategies: `sma-crossover`, `mean-reversion`, `breakout`
- [ ] Results are consistent with client-side engine for the same inputs

---

## 9. Hardened Service Auth

### Objective

Replace the shared-secret service authentication model with short-lived signed tokens and establish a secret rotation process.

### Current State

Service auth relies on a single shared `TRADE_WEBHOOK_SECRET` plus Discord identity headers (per `lib/service-auth.ts`). If the secret leaks, any linked user could be impersonated on service-enabled routes.

### Required Changes

#### Change 9.1: Short-lived Signed Service Tokens

**Files:** `lib/service-auth.ts`, `services/discord-bot/src/utils.ts`
**Action:** MODIFY
**Complexity:** MEDIUM

Replace the static bearer token with short-lived JWTs (e.g., 5-minute expiry) signed with the shared secret. Include the Discord user ID as a claim.

**Acceptance Criteria:**
- [ ] Service tokens expire after a short window (configurable, default 5 minutes)
- [ ] Expired tokens are rejected
- [ ] Discord user identity is embedded in the token (not passed as a separate header)

#### Change 9.2: Secret Rotation Playbook

**File:** `docs/SECRET_ROTATION.md`
**Action:** CREATE
**Complexity:** LOW

Document the process for rotating `TRADE_WEBHOOK_SECRET` without downtime.

**Acceptance Criteria:**
- [ ] Document exists with step-by-step rotation instructions
- [ ] Dual-secret acceptance period is described (accept old + new for a transition window)

---

## File Summary (All Active Workstreams)

### New Files to Create
| File | Purpose | Workstream |
|------|---------|------------|
| `public/google.svg` | Local Google "G" logo SVG | 7 |
| `services/discord-bot/src/commands/link.ts` | Discord `/link` onboarding command | 8 |
| `docs/SECRET_ROTATION.md` | Secret rotation playbook | 9 |

### Files to Modify
| File | Workstream | Summary |
|------|------------|---------|
| `components/trading/Toolbar.tsx` | 7 | Delete confirmation, responsive, remove avatar sign-out, shadcn Button |
| `components/trading/TradeDetailSheet.tsx` | 7 | Initialize notes from trade |
| `components/trading/Sidebar.tsx` | 7 | Mobile bottom nav, aria-labels |
| `app/page.tsx` | 7 | Responsive padding, ARIA on overlay |
| `components/trading/JournalTab.tsx` | 7 | Focus ring styles |
| `components/trading/FilterTab.tsx` | 7 | Focus ring styles, shadcn Button |
| `components/trading/BacktestingTab.tsx` | 7 | Focus rings, shadcn Select, responsive grid, context files badge |
| `components/trading/BrokerSyncTab.tsx` | 7 | Focus rings, shadcn Select, empty accounts state |
| `app/login/page.tsx` | 7 | Local Google SVG |
| `app/layout.tsx` | 7 | MotionConfig reduced motion |
| `components/trading/DashboardTab.tsx` | 7 | Memoize stats, shadcn Button |
| `components/trading/TradeTable.tsx` | 7 | Fix colspan |
| `components/trading/PerformanceCharts.tsx` | 7 | Type formatters |
| `components/trading/CandlestickChart.tsx` | 7 | ResizeObserver |
| `components/trading/TradingCalendar.tsx` | 7 | Responsive grid |
| `next.config.ts` | 7 | Remove gstatic.com from remotePatterns |
| `app/api/webhooks/trade-event/route.ts` | 8 | Implement event forwarding |
| `lib/service-auth.ts` | 9 | Short-lived JWT tokens |
| `services/discord-bot/src/utils.ts` | 9 | Use signed tokens |

---

## Implementation Order

1. **UI/UX Hardening — Critical fixes** (7.1, 7.2, 7.3, 7.4) — highest user-facing impact
2. **UI/UX Hardening — Accessibility** (7.5, 7.6, 7.7, 7.8) — WCAG compliance
3. **UI/UX Hardening — Polish** (7.9-7.20) — consistency and minor fixes
4. **Service Layer Completions** (workstream 8) — Discord onboarding, webhooks, alerts, worker parity
5. **Hardened Service Auth** (workstream 9) — security improvement

Within workstream 7, the changes are independent and can be implemented in any order. The grouping above reflects priority, not dependency.

---

## Tech Stack Reference

- **Framework**: Next.js 15 (App Router, `'use client'` components)
- **Auth**: NextAuth v5 (beta 30) with Google provider, JWT strategy, `ALLOWED_EMAILS` gating
- **Database**: PostgreSQL via Neon + Drizzle ORM, schema in `lib/db/schema.ts`
- **UI**: shadcn/ui (New York style), Tailwind CSS v4, Radix primitives
- **Charts**: Recharts v3, lightweight-charts v5 (CandlestickChart)
- **Forms**: React Hook Form + Zod v4
- **Animations**: motion (motion/react) v12
- **Toasts**: Sonner v2
- **Icons**: Lucide React v0.553
- **Mobile detection**: `hooks/use-mobile.ts` — `useIsMobile()` hook (768px breakpoint)
- **Services**: Redis, backtest-gateway (Express + BullMQ), backtest-worker (Python), Discord bot (discord.js)

## Existing Patterns to Follow

- API routes use `auth()` from `@/lib/auth-config` for session validation
- Database access via `getDb()` (HTTP) or `getPoolDb()` (transactional) from `@/lib/db`
- User validation via `requireUser()` and `ensureUser()` from `@/lib/server-db-utils`
- Toast notifications via `toast()`, `toast.success()`, `toast.error()` from Sonner
- All components use Tailwind classes with the existing dark theme variables
- Card backgrounds: `bg-[#121214] border border-white/5 rounded-2xl`
- Primary accent: emerald (`text-emerald-500`, `bg-emerald-500/10`)
- Animations: `motion.div` with `initial/animate/exit` opacity + y-translate
- Confirmation dialogs use shadcn `Dialog` component (see `SettingsMenu.tsx` for pattern)
- Select dropdowns use shadcn `Select` component (see `NewTradeDialog.tsx` for pattern)
- Mobile detection uses `useIsMobile()` from `hooks/use-mobile.ts`
