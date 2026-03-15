# Nexus Terminal — HANDOFF.md

> Generated: 2026-03-13 | Agent: nexus-architect
> Status: READY FOR EXECUTION

## Codebase Audit — Cleanup & Hardening Sprint

This handoff contains 8 implementation tasks from a full codebase audit. All tasks are
low-complexity with no architectural changes. Execute in order — Task 1 (security) is highest priority.

---

## Task 1: Enforce ALLOWED_EMAILS in Auth (SECURITY — HIGH PRIORITY)

**Problem:** Any Google account can sign in. The `ALLOWED_EMAILS` env var is documented in `.env.example` but never checked.

**File:** `lib/auth-config.ts`

**Implementation:**

Add a `signIn` callback to the NextAuth config that rejects users not in the allowlist. When `ALLOWED_EMAILS` is empty or unset, allow all users (current behavior).

```typescript
// In the callbacks object, add signIn before authorized:
signIn({ user }) {
  const allowedRaw = process.env.ALLOWED_EMAILS?.trim();
  if (!allowedRaw) return true; // empty = allow all
  const allowed = allowedRaw.split(',').map(e => e.trim().toLowerCase());
  return allowed.includes(user.email?.toLowerCase() ?? '');
},
```

Insert this callback at `lib/auth-config.ts` inside the `callbacks` object (line 30), before the existing `authorized` callback.

**Verification:** `npx tsc --noEmit` passes. Manually test: set `ALLOWED_EMAILS=your@email.com` in `.env.local`, verify login works for that email. Set it to `other@email.com`, verify login is rejected.

---

## Task 2: Update CLAUDE.md to Match Codebase Reality

**Problem:** Multiple factual mismatches between CLAUDE.md and the actual codebase.

**File:** `.claude/CLAUDE.md`

**Changes required:**

### 2a. Fix table count and list
Replace the "Tables (11)" section with the actual 15 tables:

```
### Tables (15)
users, trades (composite PK: user_id + id), trade_executions, trade_tags, tags,
trade_import_batches, broker_sync_log, agent_memory, research_reports,
daily_ticker_summaries, saved_tickers, market_snapshots, macro_summaries,
jarvis_conversations, jarvis_request_log
```

### 2b. Update API routes section
Add these undocumented routes:

```
## Saved Tickers
- GET/POST/DELETE `/api/saved-tickers`

## Market Data
- GET `/api/market-data` (Massive API proxy)
- GET/POST `/api/market-data/daily-summary`
- GET `/api/market-data/snapshot`

## Jarvis AI
(add to existing section)
- GET `/api/jarvis/macro-summary/latest`
```

### 2c. Update Jarvis file paths
The flat `lib/jarvis-*.ts` files no longer exist. Replace the entire "Jarvis AI Pipeline" and "Jarvis Safety & Observability" sections with:

```
## Jarvis AI Pipeline (lib/jarvis/)
- lib/jarvis/client.ts — LLM wrapper with retry + circuit breaker
- lib/jarvis/types.ts — shared types (JarvisMode, JarvisRequest, JarvisResponse)
- lib/jarvis/prompts.ts — system/user prompt construction
- lib/jarvis/context.ts — conversation context assembly
- lib/jarvis/memory.ts — persistent user memory CRUD
- lib/jarvis/research.ts — research orchestration
- lib/jarvis/trade-analysis.ts — trade analysis pipeline
- lib/jarvis/askedgar.ts — AskEdgar API client
- lib/jarvis/scrape-lite.ts — lightweight web scraping
- lib/jarvis/rate-limit.ts — per-user rate limiting (30 req/hr)
- lib/jarvis/circuit-breaker.ts — LLM failure circuit breaker
- lib/jarvis/token-tracking.ts — per-request token/latency logging
- lib/jarvis/admin.ts — admin stats and memory management
```

### 2d. Remove dangling Sprint 8 spec reference
Replace `docs/SPRINT_8_SPEC.md` reference with just `docs/AE_API_DOCS.md` (the spec file doesn't exist).

### 2e. Remove the "Known Issues" item about ALLOWED_EMAILS
After Task 1 is complete, remove item 1 from Known Issues.

**Verification:** Read through the updated CLAUDE.md and spot-check file paths with `ls`.

---

## Task 3: Rename package.json

**Problem:** `package.json` name is `"ai-studio-applet"`, a leftover from the project's origin.

**Files:** `package.json`

**Change:** Line 2, replace `"ai-studio-applet"` with `"nexus-terminal"`.

**Do NOT** regenerate `package-lock.json` — just change the name field. The lock file will update on next `npm install`.

**Verification:** `npm run lint && npx tsc --noEmit`

---

## Task 4: Clean Up next.config.ts

**Problem:** Stale placeholder and naming references.

**File:** `next.config.ts`

**Changes:**

1. **Remove picsum.photos remote pattern** (lines 13-17). No code references this domain. Keep only the `lh3.googleusercontent.com` pattern (needed for Google profile photos).

2. **Update comment on line 31:** Change `"HMR is disabled in AI Studio via DISABLE_HMR env var."` to `"HMR can be disabled via DISABLE_HMR env var for agent workflows."`

**Verification:** `npm run build` still succeeds.

---

## Task 5: Delete Orphaned JarvisPanel Component

**Problem:** `components/trading/JarvisPanel.tsx` is never imported anywhere.

**Action:** Delete the file.

**Verification:** `grep -r "JarvisPanel" .` returns no results (excluding this HANDOFF.md). `npx tsc --noEmit` passes.

---

## Task 6: Rename BacktestingTab to JarvisTab

**Problem:** The "Backtesting" tab actually renders `<JarvisChat />`. There is no backtesting logic.

**Files to change:**

1. **`components/trading/BacktestingTab.tsx`** — Rename file to `JarvisTab.tsx`. Update the default export name from `BacktestingTab` to `JarvisTab`.

2. **`components/trading/Sidebar.tsx`** — In the `TabKey` type (line 10), replace `'backtesting'` with `'jarvis'`. Update the corresponding sidebar item's label from "Backtesting" to "Jarvis" and icon from `FlaskConical` to a chat/bot icon (e.g., keep `FlaskConical` or use `MessageSquare` from lucide-react — user preference).

3. **`app/page.tsx`** — Update the import from `BacktestingTab` to `JarvisTab`. Update the `activeTab === 'backtesting'` conditional to `activeTab === 'jarvis'`.

**Verification:** `npx tsc --noEmit` passes. Dev server renders the tab correctly.

---

## Task 7: Fix `any` Types (6 Locations)

**Problem:** Explicit `any` usages reduce type safety.

**Changes (fix the ones that are straightforward, skip if typing is genuinely impossible):**

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `lib/csv-parser.ts` | ~250 | `data: any[]` | `data: Record<string, string>[]` (papaparse returns string fields) |
| `components/trading/TradingCalendar.tsx` | ~68-69 | `any[]` for weeks | `(DayData \| null)[][]` or whatever the day type is in that file |
| `components/trading/CandlestickChart.tsx` | ~549 | `param: any` | `param: MouseEventParams` from `lightweight-charts` (import the type) |

**Skip these (acceptable):**
- `lib/db.ts:8` — internal legacy compat layer
- `lib/trading-utils.ts:22` — intentional coercion of unknown input
- `hooks/use-trades.ts:776` — non-standard DOM API (`webkitRelativePath`)

**Verification:** `npx tsc --noEmit` passes after each change.

---

## Execution Checklist

```
[x] Task 1: ALLOWED_EMAILS enforcement in lib/auth-config.ts
[x] Task 2: Update .claude/CLAUDE.md (tables, routes, Jarvis paths, Sprint 8 ref)
[x] Task 3: Rename package.json name to "nexus-terminal"
[x] Task 4: Clean next.config.ts (remove picsum.photos, update comment)
[x] Task 5: Delete components/trading/JarvisPanel.tsx
[x] Task 6: Rename BacktestingTab → JarvisTab (3 files)
[x] Task 7: Fix 3 `any` types (csv-parser, TradingCalendar, CandlestickChart)
```

**Post-execution:** Run `npm run lint && npx tsc --noEmit && npm run test` to verify nothing is broken.

---
---

# AskEdgar API: Add filing-titles endpoint + update docs

> Generated: 2026-03-13 | Agent: nexus-architect
> Status: READY FOR EXECUTION

## Summary
- Add `/v1/filing-titles` endpoint to `askedgar.ts`
- Keep all 12 existing endpoints (no cuts — each maps to a distinct report section)
- Replace `docs/AE_API_DOCS.md` with the updated API docs
- Skip: ownership, offerings-advanced, dilution-data-advanced, rofr (institutional), screener/options (meta), ai-chart-analysis (+20% only), research-reports (+40% only), market-strength (market-wide)

## Task 8: Add `/v1/filing-titles` endpoint

### 8a. `lib/jarvis/askedgar.ts`
- Add `'filing-titles'` to the `EndpointKey` union type (line ~120-132)
- Add fetch function following the existing pattern:
```typescript
async function fetchFilingTitles(ticker: string, limit = 20) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/filing-titles', { ticker: validated, limit });
}
```
- Add entry to `endpointConfigs` array in `fetchTickerData()` (line ~261-274):
```typescript
{ key: 'filing-titles', label: 'Filing Titles', run: () => fetchFilingTitles(normalizedTicker, 20) },
```

### 8b. `lib/jarvis/types.ts`
- Add `FilingTitleItem` interface:
```typescript
export interface FilingTitleItem {
  accessionNumber: string;
  cik: string;
  ticker: string;
  headline: string;
  filedAt: string;
  fileNo: string;
  formType: string;
  documentUrl: string;
}
```
- Add `filingTitles: FilingTitleItem[]` to the `DilutionResearchReport` interface (after `reverseSplits`)

## Task 9: Replace API docs

### 9a. `docs/AE_API_DOCS.md`
- Replace entire file contents with the updated docs from `/mnt/c/Users/jared/Downloads/Ask Edgar Updated API Docs .md`

## Verification
```bash
npm run lint && npx tsc --noEmit
```

## Execution Checklist

```
[x] Task 8a: Add filing-titles endpoint support in lib/jarvis/askedgar.ts
[x] Task 8b: Add FilingTitleItem + filingTitles in lib/jarvis/types.ts
[x] Task 9a: Replace docs/AE_API_DOCS.md from updated source doc
[x] Validation: npm run lint
[x] Validation: npx tsc --noEmit
[x] Validation: npm test
```

---

# Research Report Reliability + Rendering Fix

> Generated: 2026-03-13 | Agent: opencode
> Status: READY FOR EXECUTION

## Goal
- Prevent stale null/error research reports from being reused as valid cache.
- Allow explicit refresh to bypass same-day cache.
- Surface AskEdgar warnings/errors in API/chat responses.
- Render dilution research in structured UI in Jarvis chat instead of raw JSON dump.

## Task 10: Cache Validity + Force Refresh

### 10a. `lib/jarvis/research.ts`
- Add optional `forceRefresh` parameter to `runResearchPipeline(userId, ticker, options?)`.
- Bypass cached report lookup when `forceRefresh` is true.
- Add cache eligibility guard so only valid reports are reused:
  - status must be `complete`
  - `reportJson` must be a non-null object
  - `rawData` must contain AskEdgar endpoint payloads and not include endpoint-level `error` fields
- Return `warnings` consistently for both cached and fresh runs.

### 10b. `app/api/jarvis/research/route.ts`
- Accept optional boolean `force` in POST body.
- Pass `{ forceRefresh: force }` into `runResearchPipeline`.

## Task 11: Warning/Error Passthrough for Chat Research

### 11a. `app/api/jarvis/chat/route.ts`
- For `/research TICKER` responses, include `warnings` and `fromCache` in JSON response alongside `reportJson`.

### 11b. `lib/jarvis/types.ts`
- Extend `JarvisResponse` with optional `warnings?: string[]` and `fromCache?: boolean`.

## Task 12: Structured Dilution Report Rendering in Chat

### 12a. `components/trading/JarvisChat.tsx`
- Add a narrow type guard for `DilutionResearchReport` payloads.
- Replace raw `JSON.stringify(reportJson)` rendering path with:
  - `JarvisStructuredResponse` with `dilutionReport` when payload matches schema
  - fallback text rendering for non-matching payloads
- Plumb `warnings` through message payload and pass to `JarvisStructuredResponse`.

## Verification
```bash
npm run lint
npx tsc --noEmit
npm test
```

## Execution Checklist

```
[x] Task 10a: Add force refresh + cache eligibility guard in lib/jarvis/research.ts
[x] Task 10b: Accept POST force flag in app/api/jarvis/research/route.ts
[x] Task 11a: Include warnings/fromCache in app/api/jarvis/chat/route.ts research response
[x] Task 11b: Extend JarvisResponse with warnings/fromCache in lib/jarvis/types.ts
[x] Task 12a: Render structured dilution report in components/trading/JarvisChat.tsx
[x] Validation: npm run lint
[x] Validation: npx tsc --noEmit
[x] Validation: npm test
```

---

## Task 13: Add Force-Refresh UI Control for Research

### 13a. `components/trading/ResearchTab.tsx`
- Add a second action button in AI Reports: `Refresh (Ignore Cache)`.
- Update `runResearch` to accept a `force` flag and send `{ force: true }` to `/api/jarvis/research` when refresh is requested.

## Execution Checklist

```
[x] Task 13a: Add Refresh (Ignore Cache) button and force flag request payload in components/trading/ResearchTab.tsx
```

---

# Research Report Null-Payload UX + Validation Plan

> Generated: 2026-03-13 | Agent: opencode
> Status: COMPLETE (IMPLEMENTED)

## Goal
- Prevent malformed/non-schema research payloads from being treated as valid cached reports.
- Improve chat rendering for non-schema report payloads so users do not see a raw JSON wall by default.
- Surface cache/warning context clearly in Jarvis chat responses.

## Task 14: Schema Validation Before Cache Reuse

### 14a. `lib/jarvis/research.ts`
- Add strict schema-shape validation helper for `DilutionResearchReport` payloads.
- Tighten `canReuseCachedReport(...)` to require:
  - `status === 'complete'`
  - report JSON matches dilution report schema shape
  - rawData exists and has no endpoint-level `error` entries
- If cached report fails validation, bypass cache and regenerate.

## Task 15: Chat Fallback Rendering + Warning Visibility

### 15a. `components/trading/JarvisChat.tsx`
- Keep structured render path for valid `DilutionResearchReport` payloads.
- Replace raw JSON fallback with compact, user-readable fallback panel:
  - short message that report payload is incomplete/unstructured
  - show warnings list when present
  - optional small "view raw payload" details block for debugging

### 15b. `components/trading/JarvisStructuredResponse.tsx`
- Ensure warning panel is shown consistently for both structured and fallback-style rendering paths.

## Task 16: Chat-Level Refresh/Caching Clarity

### 16a. `app/api/jarvis/chat/route.ts`
- Add support for optional forced refresh from chat command variant:
  - `/research! TICKER` or `/research TICKER --force`
- Pass `{ forceRefresh: true }` to `runResearchPipeline(...)` when force flag is used.
- Include `fromCache` and `warnings` in response (already present; keep as contract).

### 16b. `components/trading/JarvisChat.tsx`
- Display a compact status line for research responses:
  - "Source: Cache" vs "Source: Fresh"
  - warning count badge when warnings exist

## Verification
```bash
npm run lint
npx tsc --noEmit
npm test
```

## Execution Checklist

```
[x] Task 14a: Tightened cache reuse validation to require DilutionResearchReport shape in lib/jarvis/research.ts
[x] Task 15a: Replaced raw JSON fallback with compact fallback + raw payload details in components/trading/JarvisChat.tsx
[x] Task 15b: Ensured warnings render in both structured/fallback paths in components/trading/JarvisStructuredResponse.tsx
[x] Task 16a: Added `/research!` and `--force` command support in app/api/jarvis/chat/route.ts
[x] Task 16b: Added cache source + warning count status badges in components/trading/JarvisChat.tsx
[x] Validation: npm run lint
[x] Validation: npx tsc --noEmit
[x] Validation: npm test
```

---
---

# UI/UX Polish Sprint — Consistency & Refinement

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: READY FOR EXECUTION

## Summary

Full audit of all frontend components revealed systematic inconsistencies across page headers,
card styling, colors, border radius, spacing, animations, inputs, buttons, and toggles.
This plan standardizes everything to a single design language.

**Design decisions made:**
- Page headers: Pattern B (semibold title + subtitle, no border)
- Charts tab: Keeps its unique blue-tinted palette; everything else unifies
- Dashboard stat cards: Keep the hero/secondary visual hierarchy
- Jarvis AI colors: Emerald/zinc only (remove violet/cyan)
- Border radius: `rounded-xl` everywhere for section cards
- Keep hardcoded color values (no migration to CSS token classes)

---

## Task 17: Standardize Page Headers to Pattern B

**Problem:** Dashboard, Performance, Journal, and Trades use `<h2> font-bold` with a `border-b` separator. Markets, Research, and Jarvis use `<h1> font-semibold` with a `<p>` subtitle and no border. Pick Pattern B everywhere.

### 17a. `components/trading/DashboardTab.tsx`

**Line 119-121** — Replace the header row (when trades exist):
```tsx
// OLD
<div className="flex flex-wrap items-center justify-between border-b border-white/10 pb-4">
  <h2 className="text-2xl font-bold">Dashboard</h2>

// NEW
<div className="flex flex-wrap items-center justify-between">
  <div>
    <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
    <p className="text-sm text-zinc-400">Overview of your trading performance.</p>
  </div>
```

Keep the Net/Gross PnL toggle in the same flex row — it stays as-is on the right side. Close the `<div>` wrapper around the toggle as before.

**Line 99** — Empty state title stays as-is (it's a welcome message, not a page header).

### 17b. `components/trading/PerformanceTab.tsx`

**Line 29-30** — Replace header:
```tsx
// OLD
<div className="flex flex-wrap items-center justify-between border-b border-white/10 pb-4">
  <h2 className="text-2xl font-bold">Performance Analytics</h2>

// NEW
<div className="flex flex-wrap items-center justify-between">
  <div>
    <h1 className="text-2xl font-semibold text-white">Performance Analytics</h1>
    <p className="text-sm text-zinc-400">Detailed breakdowns of win rate, R-multiples, and symbol distribution.</p>
  </div>
```

Keep the `$ Metrics / R Metrics` toggle on the right side.

### 17c. `components/trading/JournalTab.tsx`

**Line 162-175** — Replace header:
```tsx
// OLD
<div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
  <div className="flex items-center gap-4">
    <h2 className="text-2xl font-bold">Trading Journal</h2>

// NEW
<div className="flex flex-wrap items-center justify-between gap-4">
  <div className="flex items-center gap-4">
    <div>
      <h1 className="text-2xl font-semibold text-white">Trading Journal</h1>
      <p className="text-sm text-zinc-400">Daily trade replay with charts and notes.</p>
    </div>
```

Keep the search input in the same flex row.

### 17d. `components/trading/TradesTab.tsx`

**Line 72-74** — Replace header:
```tsx
// OLD
<div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
  <div className="flex flex-wrap items-center gap-4">
    <h2 className="text-2xl font-bold">Trades Management</h2>

// NEW
<div className="flex flex-wrap items-center justify-between gap-3">
  <div className="flex flex-wrap items-center gap-4">
    <div>
      <h1 className="text-2xl font-semibold text-white">Trades Management</h1>
      <p className="text-sm text-zinc-400">Filter, tag, and manage all imported trades.</p>
    </div>
```

Keep the search input and badges in the same flex row.

**Verification:** Dev server — all 8 tabs should now have the same header pattern: `text-2xl font-semibold` title + `text-sm text-zinc-400` subtitle, no bottom border.

---

## Task 18: Add Motion Animations to Markets, Research, Jarvis

**Problem:** Dashboard/Performance/Journal/Trades/Charts all fade+slide in via `motion.div`. Markets, Research, and Jarvis use plain `<section>` with no animation, causing a jarring difference when switching tabs.

### 18a. `components/trading/MarketsTab.tsx`

Add import at top:
```tsx
import { motion } from 'motion/react';
```

**Line 241** — Replace the outer element:
```tsx
// OLD
<section className="space-y-5">

// NEW
<motion.section key="markets" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
```

**Also** change the closing `</section>` to `</motion.section>`.

### 18b. `components/trading/ResearchTab.tsx`

Add import at top:
```tsx
import { motion } from 'motion/react';
```

**Line 171** — Replace outer element:
```tsx
// OLD
<section className="space-y-5">

// NEW
<motion.section key="research" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
```

Change closing `</section>` to `</motion.section>`.

### 18c. `components/trading/JarvisTab.tsx`

Add import at top:
```tsx
import { motion } from 'motion/react';
```

**Line 7** — Replace outer element:
```tsx
// OLD
<section className="space-y-5">

// NEW
<motion.section key="jarvis" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
```

Change closing `</section>` to `</motion.section>`.

**Verification:** Switch between all tabs in dev — every tab should now smoothly fade+slide in.

---

## Task 19: Standardize Section Spacing to `space-y-6`

**Problem:** Tabs use `space-y-5`, `space-y-6`, or `space-y-8` inconsistently.

### Changes (one-line each):

| File | Line | Old | New |
|------|------|-----|-----|
| `DashboardTab.tsx` | 96 | `space-y-8` | `space-y-6` |
| `PerformanceTab.tsx` | 28 | `space-y-8` | `space-y-6` |
| `TradesTab.tsx` | 70 | `space-y-8` | `space-y-6` |

Note: JournalTab already uses `space-y-6`. Markets/Research/Jarvis were changed to `space-y-6` in Task 18.

**Verification:** Visual check — spacing between sections should feel uniform across all tabs.

---

## Task 20: Standardize Card Borders to `border-white/10`

**Problem:** Some cards use `border-white/5` (barely visible) and others use `border-white/10`. Standardize to `border-white/10` everywhere.

### Files to update (find-and-replace `border-white/5` → `border-white/10`):

1. **`components/trading/DashboardTab.tsx`** — Lines 98, 138, 144, 148, 157, 161, 165, 169, 218, 236, 316
2. **`components/trading/PerformanceTab.tsx`** — Lines 68, 91
3. **`components/trading/JournalTab.tsx`** — Lines 215, 236, 259
4. **`app/page.tsx`** — Lines 96, 103, 106-108 (loading skeleton)

Use a global find-replace within each file: replace all `border-white/5` with `border-white/10`.

**Do NOT touch:** `components/trading/Sidebar.tsx` (the sidebar border-right is `border-white/5` by design — it should be subtle).

**Verification:** Cards across all tabs should have uniformly visible borders.

---

## Task 21: Standardize Card Border Radius to `rounded-xl`

**Problem:** Cards use `rounded-2xl` on some tabs and `rounded-xl` on others.

### Files to update (replace `rounded-2xl` → `rounded-xl` for card containers only):

1. **`components/trading/DashboardTab.tsx`** — Lines 98, 138, 144, 148, 157, 161, 165, 169, 316
2. **`components/trading/PerformanceTab.tsx`** — Lines 68, 91
3. **`components/trading/JournalTab.tsx`** — Line 215
4. **`components/trading/PerformanceCharts.tsx`** — Find all `rounded-2xl` on chart card containers and replace with `rounded-xl`
5. **`app/page.tsx`** — Line 272 (import spinner modal)

**Do NOT touch:** `rounded-2xl` on non-card elements (if any exist on logo containers, etc.).

**Verification:** All section cards should have uniform `rounded-xl` corners.

---

## Task 22: Standardize Card Backgrounds

**Problem:** 7+ different dark background colors are used. Unify non-Charts backgrounds to `bg-[#121214]`.

### 22a. Replace `bg-black/20` with `bg-[#121214]`

Files affected:
- **`components/trading/MarketsTab.tsx`** — Lines 110, 270, 277, 284, 291, 299, 306, 327 (all `bg-black/20` → `bg-[#121214]`)
- **`components/trading/ResearchTab.tsx`** — Lines 238, 274, 340 (`bg-black/20` → `bg-[#121214]`)
- **`components/trading/JarvisTab.tsx`** — Line 17 (`bg-black/20` → `bg-[#121214]`)
- **`components/trading/JarvisMacroSummary.tsx`** — Find any `bg-black/20` → `bg-[#121214]`

### 22b. Replace `bg-[#111113]` with `bg-[#121214]`

Files affected:
- **`components/trading/MarketsTab.tsx`** — Line 257 (`bg-[#111113]` → `bg-[#121214]`)
- **`components/trading/ResearchTab.tsx`** — Lines 177, 184, 210, 254, 315 (`bg-[#111113]` → `bg-[#121214]`)
- **`components/trading/JarvisTab.tsx`** — Line 13 (`bg-[#111113]` → `bg-[#121214]`)

### 22c. Replace `bg-[#0F0F10]` with `bg-[#121214]`

- **`components/trading/JournalTab.tsx`** — Line 275 (`bg-[#0F0F10]` → `bg-[#121214]`)

### 22d. Do NOT change Charts tab colors

Leave all `bg-[#111319]`, `bg-[#0d1016]`, `bg-[#090b10]`, `bg-[#0f1219]` in `ChartsTab.tsx` as-is. The blue-tinted palette is intentional for the charting workspace.

**Verification:** All non-Charts cards/sections should share the same `#121214` background.

---

## Task 23: Standardize Dropdown/Overlay Backgrounds

**Problem:** Dropdown menus use `bg-[#121214]`, `bg-[#111319]`, or `bg-[#18181b]` depending on the file.

### Changes:

1. **`components/trading/Sidebar.tsx`** — Lines 73, 132: already `bg-[#121214]` ✓ no change
2. **`components/trading/ChartsTab.tsx`** — Lines 539, 556, 573: keep `bg-[#111319]` (Charts palette exception)
3. **`components/trading/TradeDetailSheet.tsx`** — Find any `bg-[#18181b]` → `bg-[#121214]`
4. **`components/trading/NewTradeDialog.tsx`** — Find any `bg-[#18181b]` → `bg-[#121214]`
5. **`components/ui/select.tsx`** — If `SelectContent` has `bg-[#18181b]`, change to `bg-[#121214]`

**Verification:** All dropdown/select overlays (except Charts) should have consistent `#121214` background.

---

## Task 24: Fix Dashboard Stat Label Inconsistency

**Problem:** Top stat row uses `text-xs font-mono uppercase text-zinc-500`, bottom row uses `text-xs uppercase tracking-wider text-zinc-500` (no `font-mono`). Standardize all to include `font-mono`.

### `components/trading/DashboardTab.tsx`

**Lines 158, 162, 166, 170** — The `<p>` labels in the second stats grid. Add `font-mono` class:
```tsx
// OLD
<p className="text-xs uppercase tracking-wider text-zinc-500">

// NEW
<p className="text-xs font-mono uppercase tracking-wider text-zinc-500">
```

Apply to all 4 labels: "Average MFE", "Average MAE", "Average Exit Efficiency", "Largest Win / Loss".

Also add `tracking-wider` to the top 3 stat labels (lines 139, 145, 149) for full consistency:
```tsx
// OLD
<div className="mb-2 text-xs font-mono uppercase text-zinc-500">

// NEW
<div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">
```

**Verification:** All 7 stat labels on Dashboard should now look identical in style.

---

## Task 25: Fix Research Tab Toggle Active Style

**Problem:** Research tab uses `bg-emerald-500/15 text-emerald-200` for the active toggle state. Every other toggle in the app uses `bg-emerald-500 text-black`.

### `components/trading/ResearchTab.tsx`

**Lines 188, 195, 202** — Update the active state classes on all 3 tab buttons:
```tsx
// OLD
className={`rounded-md px-3 py-1.5 text-xs ${activeView === 'ai-reports' ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-300 hover:bg-white/5'}`}

// NEW
className={`rounded-md px-3 py-1.5 text-xs font-medium ${activeView === 'ai-reports' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
```

Apply the same change to all 3 buttons (ai-reports, daily-summaries, saved-tickers), updating each one's conditional check accordingly.

**Verification:** Research tab toggles should now look identical to Dashboard PnL and Performance metric toggles.

---

## Task 26: Standardize Input Styling

**Problem:** Three different input patterns exist: standard (Trades tab), compact inline (Journal tab), and dark bg (Research tab).

### 26a. Research Tab Inputs — `components/trading/ResearchTab.tsx`

**Lines 216, 260, 321, 327** — Replace `bg-black/20` with `bg-white/5` on all `<input>` elements:
```tsx
// OLD
className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-emerald-500/40"

// NEW
className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
```

Apply the same focus-ring pattern to all Research tab inputs for consistency with Journal/Trades inputs.

### 26b. Journal Tab Inline Inputs — `components/trading/JournalTab.tsx`

**Lines 181-189** — Replace the compact risk input with standard styling:
```tsx
// OLD
<input
  type="number"
  placeholder="$500"
  value={riskInput}
  onChange={(event) => onRiskInputChange(event.target.value)}
  className="w-16 border-b border-white/10 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
/>
<button onClick={onApplyRisk} className="text-[10px] font-bold uppercase text-emerald-500 hover:text-emerald-400">
  Apply
</button>

// NEW
<input
  type="number"
  placeholder="$500"
  value={riskInput}
  onChange={(event) => onRiskInputChange(event.target.value)}
  className="w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
/>
<button onClick={onApplyRisk} className="rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase text-black hover:bg-emerald-400">
  Apply
</button>
```

**Lines 195-203** — Same treatment for the tag input:
```tsx
// OLD
<input
  type="text"
  placeholder="Add Tag..."
  value={bulkTagInput}
  onChange={(event) => onBulkTagInputChange(event.target.value)}
  className="w-20 border-b border-white/10 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
/>
<button onClick={onBulkAddTag} className="text-[10px] font-bold uppercase text-emerald-500 hover:text-emerald-400">
  Add
</button>

// NEW
<input
  type="text"
  placeholder="Add Tag..."
  value={bulkTagInput}
  onChange={(event) => onBulkTagInputChange(event.target.value)}
  className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]"
/>
<button onClick={onBulkAddTag} className="rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-bold uppercase text-black hover:bg-emerald-400">
  Add
</button>
```

**Verification:** All inputs across the app should now have the same border, background, and focus-ring pattern.

---

## Task 27: Convert Raw Buttons to `<Button>` Component

**Problem:** Some primary actions use raw `<button>` elements with manually applied emerald styling instead of the `<Button>` component from `components/ui/button.tsx`.

### 27a. `components/trading/ResearchTab.tsx`

Add import at top if not present:
```tsx
import { Button } from '@/components/ui/button';
```

**Line 222-225** — Replace "New Report" button:
```tsx
// OLD
<button type="button" disabled={loadingResearch} onClick={() => void runResearch(false)}
  className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-60">
  {loadingResearch ? 'Running...' : 'New Report'}
</button>

// NEW
<Button disabled={loadingResearch} onClick={() => void runResearch(false)}
  className="bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400">
  {loadingResearch ? 'Running...' : 'New Report'}
</Button>
```

Apply same pattern to "Refresh (Ignore Cache)" button (line 228-232), "Get Daily Summary" (line 267-270), and "Save" (line 331-335).

### 27b. `components/trading/MarketsTab.tsx`

Add import at top:
```tsx
import { Button } from '@/components/ui/button';
```

**Line 247-253** — Replace "Refresh" button:
```tsx
// OLD
<button type="button" onClick={...} disabled={...}
  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 ...">

// NEW
<Button variant="outline" onClick={...} disabled={...}
  className="border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10">
```

**Verification:** `npm run lint && npx tsc --noEmit`. All primary action buttons should render identically.

---

## Task 28: Remove Non-Standard Violet/Cyan from Jarvis

**Problem:** `JarvisStructuredResponse.tsx` uses violet and cyan accent colors that don't exist elsewhere.

### `components/trading/JarvisStructuredResponse.tsx`

**Line ~39** — Replace violet styling:
```tsx
// OLD
border-violet-500/30 bg-violet-500/10 text-violet-200

// NEW
border-emerald-500/30 bg-emerald-500/10 text-emerald-200
```

**Line ~42** — Replace cyan styling:
```tsx
// OLD
border-cyan-500/30 bg-cyan-500/10 text-cyan-200

// NEW
border-zinc-500/30 bg-zinc-500/10 text-zinc-200
```

### `components/trading/JarvisDilutionReport.tsx`

**Line ~40** — Replace cyan styling:
```tsx
// OLD
border-cyan-500/20 ... bg-cyan-500/5

// NEW
border-emerald-500/20 ... bg-emerald-500/5
```

**Verification:** Jarvis responses should use only emerald and zinc accent colors.

---

## Task 29: Add `tabular-nums` to Numeric Data

**Problem:** Numeric values in tables and stat cards don't use tabular (fixed-width) numbers, so columns don't align by decimal point.

### 29a. `components/trading/TradeTable.tsx`

Add `tabular-nums` to the `<table>` or `<tbody>` element so all numeric cells inherit it:
```tsx
// Find the <table> or wrapper element and add tabular-nums
className="... tabular-nums"
```

### 29b. `components/trading/DashboardTab.tsx`

**Lines 140-141, 146, 150-151** — Add `tabular-nums` to the large stat values:
```tsx
// The text-3xl stat value divs — add tabular-nums
className={`text-3xl font-bold tracking-tight tabular-nums ${getPnLColor(stats.totalPnl)}`}
```

Apply to all 3 hero stats and the 4 secondary stats (`text-xl font-semibold` lines 159, 163, 167).

### 29c. `components/trading/MarketsTab.tsx`

Add `tabular-nums` to the `<table>` elements in `MoversTable` and to `InstrumentCard` price display.

### 29d. `components/trading/PerformanceStatsTable.tsx`

Add `tabular-nums` to the stats table wrapper.

**Verification:** Numbers in tables and stat cards should align neatly in columns.

---

## Task 30: Standardize Hover on Emerald Buttons

**Problem:** Some emerald buttons use `hover:bg-emerald-400` (lighter on hover) and others use `hover:bg-emerald-600` (darker on hover).

### Global fix

In all files, replace `hover:bg-emerald-600` with `hover:bg-emerald-400`. The pattern is: lighter on hover = feels more responsive/interactive.

Files to check:
- `components/trading/TradesTab.tsx` — Lines 111, 123, 136

**Verification:** All emerald buttons should lighten on hover uniformly.

---

## Execution Checklist

```
[ ] Task 17: Standardize page headers to Pattern B (4 files: DashboardTab, PerformanceTab, JournalTab, TradesTab)
[ ] Task 18: Add motion animations to Markets, Research, Jarvis (3 files)
[ ] Task 19: Standardize section spacing to space-y-6 (3 files: DashboardTab, PerformanceTab, TradesTab)
[ ] Task 20: Standardize card borders to border-white/10 (4 files: DashboardTab, PerformanceTab, JournalTab, page.tsx)
[ ] Task 21: Standardize card border-radius to rounded-xl (5 files)
[ ] Task 22: Standardize card backgrounds to bg-[#121214] (5 files, skip ChartsTab)
[ ] Task 23: Standardize dropdown backgrounds to bg-[#121214] (3-4 files, skip ChartsTab)
[ ] Task 24: Fix Dashboard stat label inconsistency (DashboardTab.tsx)
[ ] Task 25: Fix Research tab toggle active style (ResearchTab.tsx)
[ ] Task 26: Standardize input styling (ResearchTab, JournalTab)
[ ] Task 27: Convert raw buttons to <Button> component (ResearchTab, MarketsTab)
[ ] Task 28: Remove violet/cyan from Jarvis (JarvisStructuredResponse, JarvisDilutionReport)
[ ] Task 29: Add tabular-nums to numeric data (TradeTable, DashboardTab, MarketsTab, PerformanceStatsTable)
[ ] Task 30: Standardize hover:bg-emerald-400 on all emerald buttons (TradesTab)
[ ] Validation: npm run lint
[ ] Validation: npx tsc --noEmit
[ ] Validation: Visual check — switch between all 8 tabs, verify uniform look
```

**Post-execution:** Run `npm run lint && npx tsc --noEmit` after every 2-3 tasks to catch issues early.
