# Codex Prompt: Fix Existing Features in Nexus Terminal

## Project Overview

Nexus Terminal is a Next.js 15 (App Router) trading journal built with React 19, TypeScript, Tailwind CSS 4, Recharts, and Motion. All trade data is stored in `localStorage`. The app lets users import Charles Schwab CSV trade logs, view performance analytics, manage a trade journal with tagging, and filter trades.

The codebase is in a working but incomplete state. This prompt covers **every concrete bug, broken feature, and missing wiring** in the existing code. Do NOT add new features, new pages, or a database layer. Stay within the existing architecture (localStorage, client-side state, current file structure).

---

## File Map

```
app/page.tsx                          — Main dashboard (all tabs, state, handlers)
app/layout.tsx                        — Root layout
app/globals.css                       — Tailwind global styles
app/api/auth/google/url/route.ts      — Google OAuth URL generator
app/api/auth/google/callback/route.ts — Google OAuth callback
app/api/auth/schwab/url/route.ts      — Schwab OAuth URL generator
app/api/auth/schwab/callback/route.ts — Schwab OAuth callback (BROKEN)
app/api/auth/me/route.ts              — Get current session
app/api/auth/logout/route.ts          — Destroy session
components/trading/TradeTable.tsx      — Trade journal table component
components/trading/PerformanceCharts.tsx — Equity curve + bar charts
components/trading/TradingCalendar.tsx — Calendar heatmap
lib/auth.ts                           — JWT session helpers
lib/csv-parser.ts                     — CSV import + entry/exit matching
lib/trading-utils.ts                  — Formatting + PnL calculation
lib/types.ts                          — TypeScript interfaces
lib/env.ts                            — Base URL resolution
lib/utils.ts                          — Utility (cn helper)
hooks/use-mobile.ts                   — Mobile breakpoint hook
```

---

## Bugs & Issues to Fix

### 1. "New Trade" Button Is Non-Functional

**File:** `app/page.tsx` lines 442–445

The "New Trade" button in the header renders but has no `onClick` handler and does nothing.

**Fix:** Add a manual trade entry modal/form that lets the user create a trade by entering: symbol, direction (LONG/SHORT), entry price, exit price, quantity, date, and optional initial risk. On submit, construct a `Trade` object and prepend it to the `trades` state array. Use the same `Trade` interface from `lib/types.ts`. Generate the `id` as `{sortKey}|{symbol}|{direction}|manual-{timestamp}` and `sortKey` as the formatted date.

### 2. Schwab OAuth Callback Has XSS Vulnerability & Doesn't Store Tokens

**File:** `app/api/auth/schwab/callback/route.ts` lines 28–43

The callback interpolates `access_token` directly into an inline `<script>` tag via string template literal. A malicious token value could inject arbitrary JavaScript. Additionally, the tokens are never stored — they're sent to `postMessage` and discarded.

**Fix:**
- Escape the token value or pass it through a safer mechanism (e.g., set the token as an HTTP-only cookie similar to the session cookie in `lib/auth.ts`, then `postMessage` a simple success flag without the raw token).
- Create helper functions in `lib/auth.ts` to store and retrieve Schwab tokens in cookies: `setSchwabTokens(access_token, refresh_token)` and `getSchwabTokens()`.
- Update the callback to call `setSchwabTokens` before returning the HTML response.

### 3. Google OAuth Popup Has No Completion Detection

**File:** `app/page.tsx` lines 296–309

The Google login opens a popup but never polls to detect if the popup was closed without completing auth. If the user closes the popup, nothing happens and the UI gives no feedback.

**Fix:** After opening the popup, start a `setInterval` timer that checks `popup.closed`. If the popup closes and `user` is still `null`, show a brief toast or set an error state like "Login cancelled." Clear the interval when the popup closes or when the `OAUTH_AUTH_SUCCESS` message is received.

### 4. Session Cookie Configuration Breaks Localhost Development

**File:** `lib/auth.ts` lines 14–18

The session cookie is set with `secure: true` and `sameSite: 'none'`. On `localhost` without HTTPS, the browser will silently reject this cookie, making login appear broken in development.

**Fix:** Conditionally set cookie options based on environment:
```ts
const isProduction = process.env.NODE_ENV === 'production';
cookieStore.set('session', token, {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/',
});
```

### 5. "Clear All Filters" Doesn't Reset Date Range Inputs

**File:** `app/page.tsx` lines 759–768

The "Clear All Filters" button resets `filterPreset` and `selectedFilterTags` but does NOT reset `startDate` and `endDate`. Date range filters persist even after clicking clear.

**Fix:** Add `setStartDate('')` and `setEndDate('')` inside the clear button's `onClick`.

### 6. Filters Only Apply on the Filter Tab

**File:** `app/page.tsx` lines 93–122

The date/tag/preset filters only take effect when `activeTab === 'filter'`. If the user sets filters, then navigates to the journal tab, those filters silently disappear and all trades show.

**Fix:** Refactor filtering so that date range, preset, and tag filters are always applied to `filteredTrades` regardless of active tab. Add a visible indicator in the header or journal tab when filters are active (e.g., a badge showing "Filters active" with a count). Allow the user to clear filters from any tab.

### 7. Daily Performance Chart Shows Per-Trade Bars, Not Per-Day Aggregated

**File:** `components/trading/PerformanceCharts.tsx` lines 27–39

The `chartData` array has one entry per trade, not one entry per day. If a user has 5 trades on the same day, the "Daily Performance" bar chart shows 5 separate bars instead of one aggregated bar. The equity curve also plots per-trade instead of per-day cumulative.

**Fix:** Aggregate the data by `sortKey` (date) before charting. Group trades by day, sum their PnL (or R values), then build the chart data from the aggregated daily totals. The equity curve should show cumulative daily PnL, not cumulative per-trade PnL.

### 8. `rMultiple` Field in Trade Type Is Never Computed

**File:** `lib/types.ts` line 16, not set anywhere

The `Trade` interface has an `rMultiple` field but it's never populated. The R-multiple is always calculated inline as `trade.pnl / trade.initialRisk` throughout the codebase.

**Fix:** Either remove the `rMultiple` field from the interface (and keep the inline calculation), or compute and store it whenever `initialRisk` is set (in `handleApplyRisk` and during CSV import). Pick one approach for consistency — removing the unused field is simpler.

### 9. `notes` Field in Trade Type Has No UI

**File:** `lib/types.ts` line 17

The `Trade` interface includes an optional `notes` field, but there is no way to view or edit trade notes anywhere in the UI.

**Fix:** Add a notes capability to the trade table. Options (pick one):
- **Expandable row:** Clicking a trade row expands it to show a textarea for notes.
- **Modal:** Clicking a trade opens a detail modal with editable notes.
- **Inline:** Add a narrow "Notes" column with a pencil icon that opens an inline editor.

The notes should persist in localStorage with the rest of the trade data (they already will since the whole `Trade` object is serialized).

### 10. `handleDeleteSelected` Double-Writes to localStorage

**File:** `app/page.tsx` lines 143–153

`handleDeleteSelected` manually calls `localStorage.setItem` inside `setTrades`, but the `useEffect` on line 84 already persists `trades` whenever they change. This causes a redundant write.

**Fix:** Remove the `localStorage.setItem` call from inside `handleDeleteSelected`. Let the existing `useEffect` handle persistence.

### 11. Search Query Resets on Tab Change

**File:** `app/page.tsx` line 293

`handleTabChange` clears `searchQuery` every time the user switches tabs. If a user searches for "NVDA" in the journal, switches to dashboard, then comes back, their search is gone.

**Fix:** Don't clear `searchQuery` on tab change. Remove `setSearchQuery('')` from `handleTabChange`. If the intent was to clear it only for certain tabs, scope it narrowly.

### 12. Sidebar Icons for Bell, Settings, and User Are Non-Functional

**File:** `app/page.tsx` lines 368–373

The Bell, Settings, and User icons in the sidebar are plain `<Icon>` elements with no button wrapper and no click handler. They look interactive (cursor-pointer) but do nothing.

**Fix:** Either:
- Wire them up: Bell opens a notification panel (can be empty/placeholder with "No notifications"), Settings opens a settings panel (theme toggle, clear data, export data), User shows user profile info or triggers login.
- Or wrap them in `<button>` elements with an `onClick` that shows a toast like "Coming soon" so they don't feel broken.

The minimal useful implementation: Settings should at minimum let the user export their trades as JSON and clear all data. The User button should show the current user info or trigger login if not authenticated.

### 13. CSV Parser Doesn't Handle Commissions or Fees

**File:** `lib/csv-parser.ts`

Charles Schwab CSVs include columns like `Commission` and `Fees`. The parser ignores these, so PnL calculations don't account for trading costs.

**Fix:** In `processCsvData`, read the `Commission` and `Fees` columns (if present), sum them per matched trade pair, and subtract from PnL. Update the `Trade` type to optionally include `commission` and `fees` fields if you want to display them separately, or just bake them into the PnL calculation.

### 14. CSV Re-Import Overwrites Tags and Risk on Existing Trades

**File:** `app/page.tsx` lines 279–282

When re-importing CSVs for dates that already have trades, `handleFileUpload` filters out all existing trades with matching `sortKey` values and replaces them with fresh parsed trades. This destroys any tags, notes, or initialRisk the user had set on those trades.

**Fix:** When re-importing, merge new trade data with existing metadata. For each new trade, check if a trade with the same `id` (which is `{sortKey}|{symbol}|{direction}`) already exists. If so, preserve the existing trade's `tags`, `notes`, and `initialRisk` while updating the price/quantity/PnL data from the fresh import.

### 15. No Empty State for Dashboard When No Trades Exist

**File:** `app/page.tsx` lines 452–504

When the user first loads the app with zero trades, the dashboard shows "$0.00" for PnL, "0.0%" for win rate, "0.00" for profit factor, empty charts, and an empty "Recent Trades" section. There's no guidance for new users.

**Fix:** When `trades.length === 0`, show a welcome/onboarding state on the dashboard instead of the metrics cards and charts. Include:
- A brief description of what the app does
- A prominent "Import Trades" button (re-use the file upload logic)
- A note about the expected CSV format (Charles Schwab filename pattern: `MM-DD-YY.csv`)

### 16. Performance Charts Crash or Show Nothing with Zero Trades

**File:** `components/trading/PerformanceCharts.tsx`

When `trades` is empty, Recharts renders empty chart containers with axes but no data. The day-of-week and time-of-day charts filter to empty arrays. This isn't a crash, but it's a poor UX.

**Fix:** If `trades.length === 0`, return a centered message like "Import trades to see performance analytics" instead of rendering empty charts.

### 17. `GEMINI_API_KEY` and `NEXT_PUBLIC_GEMINI_API_KEY` Are Unused

**File:** `.env.example`

These environment variables are defined in the example but never referenced anywhere in the code.

**Fix:** Remove them from `.env.example` to avoid confusion. If they were intended for a future AI feature, leave a comment in the README instead.

### 18. Trade Table Tag Dropdown Can Overflow Off-Screen

**File:** `components/trading/TradeTable.tsx` lines 108–153

The tag dropdown is positioned with `absolute left-0 top-0` which means it renders from the tag cell. For trades near the bottom of the viewport, the dropdown can overflow below the screen with no way to scroll to it.

**Fix:** Add positioning logic that checks available viewport space and flips the dropdown upward when near the bottom. Alternatively, use a fixed/portal-based positioning approach. A simpler fix: set `bottom-0` instead of `top-0` and add `max-h-[200px] overflow-y-auto` to the dropdown.

---

## Implementation Notes

- **Test after each fix** by running `npm run dev` and verifying the behavior.
- **Don't refactor** unrelated code. Keep changes scoped to the issues above.
- **Don't add new dependencies** unless absolutely necessary.
- **Don't create new files** unless the fix genuinely requires it (e.g., a new component for the trade entry modal). Prefer editing existing files.
- **Preserve the existing dark theme** and Tailwind styling conventions used throughout.
- **TypeScript strictness:** Ensure all changes are type-safe. Don't use `any` unless the existing code already does in that area.
- **localStorage schema:** The app stores `nexus-trades` (JSON array of Trade objects) and `nexus-tags` (JSON array of strings). Don't change these keys or their structure in a breaking way — users may have existing data.

## Priority Order

Fix these in order of impact:

1. **#4** Session cookie localhost fix (unblocks local development)
2. **#2** Schwab callback XSS + token storage (security)
3. **#14** CSV re-import preserves metadata (data loss prevention)
4. **#5** Clear All Filters actually clears everything
5. **#6** Filters apply globally, not just on filter tab
6. **#10** Remove double localStorage write
7. **#7** Daily chart aggregation fix
8. **#1** New Trade manual entry
9. **#9** Trade notes UI
10. **#13** CSV commission/fees handling
11. **#3** OAuth popup completion detection
12. **#15** Dashboard empty state
13. **#16** Charts empty state
14. **#18** Tag dropdown overflow
15. **#11** Search query persistence across tabs
16. **#12** Sidebar icons wired up (minimal)
17. **#8** Remove unused `rMultiple` field
18. **#17** Remove unused env vars
