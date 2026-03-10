# Nexus Terminal — HANDOFF.md

> Generated: 2026-03-10 | Agent: nexus-architect
> Status: PENDING REVIEW — do not execute until approved

---

## Sprint 8 Summary (Complete)

The Dilution Research Pack (AskEdgar Integration) is fully implemented. All 11 steps are done:

- JRV-081: Dilution Research Types
- JRV-082: `api_data` Source Type
- JRV-080: AskEdgar API Client (`lib/askedgar-client.ts`)
- JRV-084: Earnings Pack Removed, Dilution Research Pack Added (`lib/jarvis-source-packs.ts`)
- JRV-083: AskEdgar Data Aggregator (`lib/askedgar-aggregator.ts`)
- JRV-085: Dilution Orchestration Prompt
- JRV-086: Route Handler (dilution-research mode in `/api/jarvis`)
- JRV-087: Dilution Report Renderer (`components/trading/JarvisDilutionReport.tsx`)
- JRV-088: Renderer Wired into `JarvisStructuredResponse`
- JRV-089: JarvisTab UI (cards, ticker input)
- JRV-090: Tests

The one remaining Sprint 8 bug — the submit button hardcoding `'assistant'` mode — is resolved by Change 4 below.

---

## Build Spec — UI Layout Overhaul

### Objective

Simplify the JarvisTab interface, fix the submit-path mode bug, correct calendar day ordering, and normalize $0 PnL color treatment across all components.

---

### Change 1: Remove Daily Summary Card from JarvisTab

- **File:** `components/trading/JarvisTab.tsx`
- **Action:** MODIFY
- **Complexity:** LOW

**Steps:**

1. In the `cards` array (starts at line 258), delete the object with `mode: 'daily-summary'` (lines 259-264).
2. On line 336, change `lg:grid-cols-5` to `lg:grid-cols-4`. (This will be reduced further in Change 2.)
3. If the `Newspaper` icon is no longer referenced anywhere in the file after this removal, remove it from the lucide-react import on line 5. Note: `getPackIcon` references `Newspaper` — check if any source pack still uses `icon: 'Newspaper'`. Currently none do (macro-daily uses `'Globe'`, dilution-research uses `'Search'`), so `Newspaper` can be removed from `getPackIcon` and from the import.

**Acceptance Criteria:**
- [ ] No "Daily Summary" card appears in the Jarvis UI
- [ ] No unused `Newspaper` import remains
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

---

### Change 2: Merge "Analyze Trades" and "Ask Jarvis" into Single Card

- **File:** `components/trading/JarvisTab.tsx`
- **Action:** MODIFY
- **Complexity:** LOW

**Steps:**

1. In the `cards` array, delete the object with `mode: 'trade-analysis'` (lines 265-270 before Change 1; adjust for prior deletion).
2. Keep the `assistant` card as "Ask Jarvis". The API already receives all trades for every mode via the `trades` field in the request payload, so no backend changes are needed.
3. Change the grid class (already modified in Change 1 to `lg:grid-cols-4`) to `lg:grid-cols-3`.
4. If `LineChart` icon is no longer referenced anywhere in the file, remove it from the lucide-react import on line 5.

After Changes 1 and 2, the `cards` array should contain exactly 3 entries:

```ts
const cards: Array<{ mode: JarvisMode; label: string; description: string; icon: typeof Bot }> = [
  {
    mode: 'assistant',
    label: 'Ask Jarvis',
    description: 'Ask for help, workflows, and market context with optional website scraping.',
    icon: Sparkles,
  },
  {
    mode: 'macro-summary',
    label: 'Macro Summary',
    description: 'Get a macro market overview across US, EU, Asia, and global markets.',
    icon: Globe,
  },
  {
    mode: 'dilution-research',
    label: 'Dilution Research',
    description: 'SEC dilution risk report via AskEdgar.',
    icon: Search,
  },
];
```

**Acceptance Criteria:**
- [ ] Only 3 cards render: Ask Jarvis, Macro Summary, Dilution Research
- [ ] Grid uses `lg:grid-cols-3`
- [ ] No unused `LineChart` import remains
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

---

### Change 3: Remove Manual URL Input

- **File:** `components/trading/JarvisTab.tsx`
- **Action:** MODIFY
- **Complexity:** MEDIUM — significant code removal

**What to remove:**

1. **Types and constants:**
   - Delete `const MAX_SCRAPE_URLS = 5;` (line 14)
   - Delete `type JarvisInputMode = 'manual' | 'pack';` (line 16)
   - Delete `type UrlEntry` (lines 18-23)

2. **Top-level helper functions:**
   - Delete `toUrlEntries()` (lines 32-49)
   - Delete `toLineStatus()` (lines 51-58)
   - Delete `isScrapeUrlValid()` (lines 61-68)

3. **State variables — delete these `useState`/`useRef` calls:**
   - `urlLines` (line 78)
   - `inputMode` (line 79)
   - `rememberedUrls` (line 81)

4. **Memos — delete these `useMemo` calls:**
   - `urlEntries` (lines 89-92)
   - `urlStatusByLine` (line 94)
   - `invalidUrlEntries` (lines 96-99)
   - `validUniqueUrls` (lines 101-112)
   - `urlsForRequest` (lines 114-117)
   - `ignoredDuplicateCount` (lines 119-122)
   - `overflowCount` (line 124)
   - `shouldRememberUrlInputs` (line 126)
   - `rememberedUrlStatus` (lines 128-135)
   - `blockedRememberedCount` (line 137)

5. **The `useEffect` that fetches remembered URLs** (lines 139-154) — delete entirely.

6. **Helper functions — delete:**
   - `setLineValue()` (lines 156-158)
   - `addLine()` (lines 160-162)
   - `removeLine()` (lines 164-169)
   - `applyRememberedUrl()` (lines 171-187)
   - `selectManualMode()` (lines 252-256)

7. **In `runJarvis()`:**
   - Line 201: Remove the `urls` field entirely from the request body. The request should not include `urls` at all.
   - Line 202: Change `sourcePackId: inputMode === 'pack' ? selectedPackId : undefined,` to `sourcePackId: selectedPackId || undefined,`
   - Lines 213-222: Delete the `shouldRememberUrlInputs` block that merges URLs into `rememberedUrls`.

8. **In `selectPack()`:**
   - Line 243: Remove `setInputMode('pack');` (inputMode no longer exists)
   - Line 248: Remove `setUrlLines(['']);` (urlLines no longer exists)

9. **JSX — remove the right column's manual URL UI:**
   - Delete the "Source Input" label (line 381)
   - Delete the Manual URLs / Source Pack toggle buttons (lines 383-398)
   - Delete the entire manual URL input branch (`inputMode === 'manual'` conditional, lines 401-469)
   - Keep only the source pack selector content (lines 471-496), but remove the `inputMode === 'pack'` conditional wrapper — always show it
   - Delete the "Remembered URLs" section (lines 500-518)

10. **Imports — remove if no longer used:**
    - `Plus` from lucide-react (line 5)
    - `X` from lucide-react (line 5)
    - `isUrlAllowed` from `@/lib/jarvis-allowlist` (line 8)

**What to keep:**
- `selectedPackId` state
- `selectedPack` memo
- `selectPack()` function (minus the inputMode/urlLines lines)
- The source pack selector buttons and prompt template display
- `getPackIcon()` function

**Acceptance Criteria:**
- [ ] No manual URL input UI renders
- [ ] No "Remembered URLs" section renders
- [ ] No "Manual URLs" / "Source Pack" toggle renders
- [ ] Source pack selector shows directly without a toggle
- [ ] `isUrlAllowed` import is removed
- [ ] `Plus` and `X` icon imports are removed (verify they are not used elsewhere in the file first)
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

---

### Change 4: Mode Cards Preload Prompts Instead of Auto-Firing

- **File:** `components/trading/JarvisTab.tsx`
- **Action:** MODIFY
- **Complexity:** LOW

This change also fixes the Sprint 8 remaining bug where the submit button hardcodes `'assistant'` mode.

**Steps:**

1. **Replace `handleCardClick()`** (lines 291-298). New behavior — clicking a card sets the mode and preloads the prompt, but does NOT call `runJarvis()`:

```ts
const handleCardClick = (nextMode: JarvisMode) => {
  setMode(nextMode);

  if (nextMode === 'macro-summary') {
    selectPack('macro-daily');
  } else if (nextMode === 'dilution-research') {
    selectPack('dilution-research');
    dilutionTickerInputRef.current?.focus();
  } else {
    // 'assistant' — clear pack, clear prompt
    setSelectedPackId('');
    setPrompt('');
  }
};
```

The card-to-pack mapping:

| Card Mode | Source Pack ID | Behavior |
|-----------|---------------|----------|
| `assistant` | none | Clears pack selection and prompt |
| `macro-summary` | `macro-daily` | Loads `macro-daily` pack prompt template |
| `dilution-research` | `dilution-research` | Loads `dilution-research` pack prompt template, focuses ticker input |

2. **Fix the "Run Jarvis" button** (line 524). Change:
```ts
onClick={() => runJarvis('assistant')}
```
to:
```ts
onClick={() => runJarvis(mode)}
```
This uses the current `mode` state, which was set when the user clicked a card.

3. **Verify** that `runJarvis()` still calls `setMode(nextMode)` on line 190. This is fine — it will set it to the same value that `handleCardClick` already set.

**Acceptance Criteria:**
- [ ] Clicking "Ask Jarvis" card sets mode to `assistant`, clears prompt, clears pack
- [ ] Clicking "Macro Summary" card sets mode to `macro-summary`, loads macro-daily prompt template
- [ ] Clicking "Dilution Research" card sets mode to `dilution-research`, loads dilution-research prompt template, focuses ticker input
- [ ] No card auto-fires `runJarvis()` on click
- [ ] "Run Jarvis" button fires `runJarvis(mode)` using current mode state
- [ ] Dilution research requests include `ticker` field
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

---

### Change 5: Weekly Calendar — Sunday on Left

- **File:** `components/trading/WeeklyCalendar.tsx`
- **Action:** MODIFY
- **Complexity:** LOW

**Steps:**

1. Line 20: Change `startOfWeek(new Date(), { weekStartsOn: 1 })` to `startOfWeek(new Date(), { weekStartsOn: 0 })`
2. Line 21: Change `endOfWeek(start, { weekStartsOn: 1 })` to `endOfWeek(start, { weekStartsOn: 0 })`

This makes Sunday the leftmost column, consistent with `TradingCalendar.tsx` which uses Sunday-first by default (date-fns default).

**Acceptance Criteria:**
- [ ] WeeklyCalendar renders Sunday as the first (leftmost) day
- [ ] Matches TradingCalendar day ordering
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

---

### Change 6: $0 Values Use Muted Color Instead of Green

- **Files:** `lib/trading-utils.ts`, `components/trading/DashboardTab.tsx`, `components/trading/WeeklyCalendar.tsx`, `components/trading/TradingCalendar.tsx`, `components/trading/JournalTab.tsx`, `components/trading/PerformanceCharts.tsx`
- **Action:** MODIFY
- **Complexity:** LOW

**Step 1: Add `getPnLHex` to `lib/trading-utils.ts`**

Add after the existing `getPnLColor` function (after line 31):

```ts
export const getPnLHex = (value: number) => {
  if (value > 0) return '#10b981';
  if (value < 0) return '#f43f5e';
  return '#71717a';
};
```

**Step 2: Replace `>= 0` ternaries in each file**

Each location below uses `>= 0` which colors $0 as green. Replace with `getPnLColor()` or `getPnLHex()` which returns muted zinc-400 for zero.

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `components/trading/DashboardTab.tsx` | 139 | `stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'` | `getPnLColor(stats.totalPnl)` |
| `components/trading/WeeklyCalendar.tsx` | 78 | `pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'` | `getPnLColor(pnl)` |
| `components/trading/TradingCalendar.tsx` | 144 | `stats.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'` | `getPnLColor(stats.pnl)` |
| `components/trading/TradingCalendar.tsx` | 162 | `week.weeklyPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'` | `getPnLColor(week.weeklyPnl)` |
| `components/trading/TradingCalendar.tsx` | 214 | `trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'` | `getPnLColor(trade.pnl)` |
| `components/trading/JournalTab.tsx` | 225 | `day.dailyNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'` | `getPnLColor(day.dailyNetPnl)` |
| `components/trading/JournalTab.tsx` | 250 | `day.dailyNetPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'` | `getPnLColor(day.dailyNetPnl)` |
| `components/trading/PerformanceCharts.tsx` | 220 | `entry.value >= 0 ? '#10b981' : '#f43f5e'` | `getPnLHex(entry.value)` |
| `components/trading/PerformanceCharts.tsx` | 243 | `entry.value >= 0 ? '#10b981' : '#f43f5e'` | `getPnLHex(entry.value)` |
| `components/trading/PerformanceCharts.tsx` | 263 | `entry.value >= 0 ? '#10b981' : '#f43f5e'` | `getPnLHex(entry.value)` |

**Step 3: Add imports**

Each file needs to import the function from `@/lib/trading-utils`:

- `DashboardTab.tsx` — add `getPnLColor` to existing import (already imports `formatCurrency`)
- `WeeklyCalendar.tsx` — add `getPnLColor` to existing `formatCurrency` import
- `TradingCalendar.tsx` — add `getPnLColor` to existing import (already imports `formatCurrency`, `formatR`)
- `JournalTab.tsx` — add `getPnLColor` to existing import (already imports `formatCurrency`)
- `PerformanceCharts.tsx` — add `getPnLHex` to existing import (already imports `formatCurrency`)

**Note:** There are additional `>= 0` color ternaries in `TradingCalendar.tsx` (lines 147, 165) for R-values that use `text-emerald-400`/`text-rose-400` (lighter shade). These are intentionally different shades and are NOT covered by `getPnLColor`. Leave them as-is. Similarly, `JournalTab.tsx` line 61 uses hex colors for an SVG sparkline — leave as-is.

**Acceptance Criteria:**
- [ ] `getPnLHex` function exists in `lib/trading-utils.ts`
- [ ] All 10 locations listed above use `getPnLColor()` or `getPnLHex()` instead of `>= 0` ternaries
- [ ] $0 PnL values render as muted zinc-400 / #71717a instead of green
- [ ] Positive values still render emerald, negative values still render rose
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

---

## Files Affected

| File | Action | Changes | Risk |
|------|--------|---------|------|
| `components/trading/JarvisTab.tsx` | MODIFY | Changes 1-4: Remove 2 cards, remove manual URL UI, fix card click + submit mode | MEDIUM — largest change, many deletions |
| `components/trading/WeeklyCalendar.tsx` | MODIFY | Change 5: weekStartsOn 0; Change 6: getPnLColor | LOW |
| `components/trading/TradingCalendar.tsx` | MODIFY | Change 6: getPnLColor (3 locations) | LOW |
| `components/trading/DashboardTab.tsx` | MODIFY | Change 6: getPnLColor (1 location) | LOW |
| `components/trading/JournalTab.tsx` | MODIFY | Change 6: getPnLColor (2 locations) | LOW |
| `components/trading/PerformanceCharts.tsx` | MODIFY | Change 6: getPnLHex (3 locations) | LOW |
| `lib/trading-utils.ts` | MODIFY | Change 6: Add getPnLHex function | LOW |

---

## Order of Operations

1. **Change 6 first** — Add `getPnLHex` to `lib/trading-utils.ts`, then update all 6 component files. This is independent and low risk.
2. **Change 5** — Fix WeeklyCalendar day ordering. Independent, trivial.
3. **Changes 1 + 2** — Remove Daily Summary and Analyze Trades cards, reduce grid. Do together since both modify the same `cards` array.
4. **Change 3** — Remove manual URL input. Largest deletion — do after cards are settled.
5. **Change 4** — Fix card click behavior and submit button mode. Do last since it depends on the final card set from Changes 1-3.
6. **Run verification** (see below).

---

## Verification

After all changes are complete, run:

```bash
npm run lint
npx tsc --noEmit
```

Then visually verify:

- [ ] Jarvis tab shows exactly 3 cards: Ask Jarvis, Macro Summary, Dilution Research
- [ ] Clicking a card does NOT auto-fire a request — it preloads the prompt
- [ ] Clicking "Run Jarvis" fires with the correct mode (not always assistant)
- [ ] Dilution Research card focuses the ticker input and loads the dilution prompt
- [ ] No manual URL input, no "Remembered URLs", no Manual/Pack toggle visible
- [ ] Source pack selector shows directly in the right column
- [ ] WeeklyCalendar starts on Sunday (leftmost)
- [ ] $0 PnL values appear in muted gray (zinc-400), not green
- [ ] Positive PnL is still emerald, negative PnL is still rose

---

## Security Considerations

- No auth changes in this spec.
- No new API routes or endpoints.
- Removal of manual URL input reduces attack surface (no user-supplied URLs sent to scraper).
- ALLOWED_EMAILS remains unenforced in auth callbacks (pre-existing, not addressed here).
