# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4, SSE Jarvis Streaming, Discord Research Schwab Validation, Research Tab Full Redesign, Direct Relay WebSocket, Macro Summary Upgrade) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

---

## Schwab Relay Auth — Parallel Blocker

> Generated: 2026-03-16 | Status: OPEN

- Relay logs show repeated `Failed to load Schwab user preference (401)`.
- This keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- Schwab refresh tokens expire every **7 days** — you need to re-login via the Schwab OAuth flow weekly.

### Next steps

1. Re-link Schwab account in the app (Markets tab → Schwab status)
2. After relinking, check Fly logs for `LOGIN successful, subscribing...` and quote-write activity
3. If 401 persists after fresh relink, investigate whether the relay is loading the correct tokens from the DB

---

## Research Tab — Dilution Warrants Enhancement

> Generated: 2026-03-22 | Agent: nexus-architect
> Status: IMPLEMENTED (manual visual validation pending)
> Priority: MEDIUM — adds actionable warrant intelligence to dilution research
> Risk: LOW — no schema migration, no new API routes, no new files

### Objective

Four changes to the Research tab: remove the redundant Risk sub-tab, replace the "Viewing: TICKER" header text with the company name, and add Outstanding Warrants and Pre-funded Warrants tables to the Dilution sub-tab with color-coded exercisability status.

### Key Decisions (confirmed with user)

- AskEdgar exercise prices are **already adjusted for reverse splits** — no split math needed
- `dilution-data-advanced` endpoint returns **403** (not available on current API tier) — no ratchet-down/price-protection data
- Yellow threshold: **any** registered + exercisable warrant where price < strike = yellow (no floor)
- Null `exercisable_date`: treat as **red** (not exercisable)
- Pre-funded warrants: separate section, default yellow, green if registered

---

### Change 1: Remove Risk Tab

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

**Step 1.1** — Remove `'risk'` from `TabKey` type union (line 23).

Current (lines 16-24):
```typescript
type TabKey =
  | 'overview'
  | 'offering-ability'
  | 'dilution'
  | 'cash'
  | 'news-filings'
  | 'offerings'
  | 'risk'
  | 'history';
```

Replace with:
```typescript
type TabKey =
  | 'overview'
  | 'offering-ability'
  | 'dilution'
  | 'cash'
  | 'news-filings'
  | 'offerings'
  | 'history';
```

**Step 1.2** — Remove the Risk entry from TABS array. Delete line 117:
```typescript
  { key: 'risk', label: 'Risk' },
```

**Step 1.3** — Delete the entire `{activeTab === 'risk' ? ...}` JSX block (lines 448-480).

Do NOT remove `pumpItem`, `complianceItem`, or their data extraction in the useMemo — keep for potential future use.

**Acceptance Criteria:**
- [x] TabKey type no longer includes `'risk'`
- [x] TABS array has 7 entries (no Risk tab)
- [x] No JSX references `activeTab === 'risk'`
- [x] `pumpItem`, `complianceItem` extraction remains intact

---

### Change 2: Replace "Viewing: TICKER" with Company Name

#### Step 2.1 — Add `onCompanyName` callback to ResearchCompanyHeader

**File:** `components/trading/ResearchCompanyHeader.tsx`
**Action:** MODIFY

Add import at top (after `'use client';`):
```typescript
import { useEffect } from 'react';
```

Update Props interface (lines 9-12):
```typescript
interface Props {
  ticker: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
  onCompanyName?: (name: string | null) => void;
}
```

Update function signature (line 66):
```typescript
export default function ResearchCompanyHeader({ ticker, rawData, onCompanyName }: Props) {
```

After line 70 (where `companyName` is extracted), add:
```typescript
  useEffect(() => {
    onCompanyName?.(companyName ? String(companyName) : null);
  }, [companyName, onCompanyName]);
```

#### Step 2.2 — Pass callback through ResearchTickerView

**File:** `components/trading/ResearchTickerView.tsx`
**Action:** MODIFY

Update Props interface (lines 23-25):
```typescript
interface Props {
  ticker: string;
  onCompanyName?: (name: string | null) => void;
}
```

Update function signature (line 27):
```typescript
export default function ResearchTickerView({ ticker, onCompanyName }: Props) {
```

Inside `fetchData`, after `setError(null);` (line 34), add:
```typescript
      onCompanyName?.(null);
```

Pass callback to ResearchCompanyHeader (line 71). Change:
```tsx
<ResearchCompanyHeader ticker={ticker} rawData={data.rawData} />
```
to:
```tsx
<ResearchCompanyHeader ticker={ticker} rawData={data.rawData} onCompanyName={onCompanyName} />
```

#### Step 2.3 — Display company name in ResearchTab

**File:** `components/trading/ResearchTab.tsx`
**Action:** MODIFY

Update import (line 3):
```typescript
import { useCallback, useState } from 'react';
```

Add state and callback after line 10:
```typescript
  const [companyName, setCompanyName] = useState<string | null>(null);

  const handleCompanyName = useCallback((name: string | null) => {
    setCompanyName(name);
  }, []);
```

In `handleTickerSubmit`, add `setCompanyName(null);` after `setSelectedTicker(ticker);`.

Replace the `onSelectTicker` prop on ResearchGainersList (line 46):
```tsx
<ResearchGainersList selectedTicker={selectedTicker} onSelectTicker={(t) => { setSelectedTicker(t); setCompanyName(null); }} />
```

Replace the span on lines 39-41:
```tsx
<span className="text-xs text-zinc-500">
  {selectedTicker
    ? companyName ?? `Loading ${selectedTicker}...`
    : 'Select a gainer or search a ticker'}
</span>
```

Pass callback to ResearchTickerView (line 51):
```tsx
<ResearchTickerView ticker={selectedTicker} onCompanyName={handleCompanyName} />
```

**Acceptance Criteria:**
- [x] No ticker selected → "Select a gainer or search a ticker"
- [x] Ticker selected, loading → "Loading TICKER..."
- [x] Data loaded → shows company name (e.g., "Workhorse Group Inc")
- [x] Switching tickers resets company name

---

### Change 3: Add Outstanding Warrants Table to Dilution Tab

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

Inside the `{activeTab === 'dilution' ? ...}` block, AFTER the existing 4-card grid / NoDataBadge ternary, still inside the `<div className="space-y-3">`, insert:

```tsx
            {/* Outstanding Warrants */}
            {(() => {
              const currentPrice = toNumberValue(getField(screenerItem, ['price']));
              const today = new Date().toISOString().slice(0, 10);

              const regularWarrants = data.dilutionData.results
                .map((item) => toRecord(item))
                .filter((row) => {
                  const hasWarrants = getField(row, ['warrants_amount']) !== null;
                  const prefunded = toNumberValue(getField(row, ['prefunded_cost']));
                  return hasWarrants && (prefunded === null || prefunded === 0);
                });

              if (regularWarrants.length === 0) {
                return (
                  <div className="space-y-2">
                    <h4 className="font-medium text-zinc-300">Outstanding Warrants</h4>
                    <p className="text-sm text-zinc-500">No outstanding warrants found</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <h4 className="font-medium text-zinc-300">Outstanding Warrants</h4>
                  <div className="overflow-x-hidden">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="py-2 pr-3 text-left">Details</th>
                          <th className="py-2 pr-3 text-left">Remaining</th>
                          <th className="py-2 pr-3 text-left">Strike</th>
                          <th className="py-2 pr-3 text-left">Registered</th>
                          <th className="py-2 pr-3 text-left">Exercisable</th>
                          <th className="py-2 pr-3 text-left">Expires</th>
                          <th className="py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regularWarrants.map((row, index) => {
                          const exercisePrice = toNumberValue(getField(row, ['warrants_exercise_price']));
                          const exercisableDate = getField(row, ['exercisable_date']) as string | null;
                          const expirationDate = getField(row, ['expiration_date']) as string | null;
                          const registered = String(getField(row, ['registered']) ?? '');

                          let status: string;
                          let colorClass: string;

                          if (exercisableDate === null) {
                            status = 'Not Exercisable';
                            colorClass = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
                          } else if (expirationDate && expirationDate < today) {
                            status = 'Expired';
                            colorClass = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
                          } else if (exercisableDate > today) {
                            status = 'Not Yet Exercisable';
                            colorClass = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
                          } else if (registered === 'Registered' && currentPrice !== null && exercisePrice !== null && currentPrice >= exercisePrice) {
                            status = 'In the Money';
                            colorClass = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
                          } else if (registered === 'Registered' && currentPrice !== null && exercisePrice !== null && currentPrice < exercisePrice) {
                            status = 'Below Strike';
                            colorClass = 'border-amber-500/30 bg-amber-500/10 text-amber-300';
                          } else {
                            status = 'Not Registered';
                            colorClass = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
                          }

                          return (
                            <tr key={`warrant-${index}`} className="border-b border-white/5">
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['details']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatNumber(getField(row, ['warrants_remaining']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatMoney(getField(row, ['warrants_exercise_price']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['registered']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['exercisable_date']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['expiration_date']))}</td>
                              <td className="py-2">
                                <span className={`rounded border px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                                  {status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
```

**Acceptance Criteria:**
- [x] Warrants table renders inside Dilution tab, below the existing 4-card grid
- [x] Only warrants with `warrants_amount` and `prefunded_cost` null/0 are shown
- [x] Color-coded: red (not exercisable/expired/null date/not registered), yellow (registered but below strike), green (registered + in the money)
- [x] "No outstanding warrants found" when no matching warrants

---

### Change 4: Add Pre-funded Warrants Section

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

Immediately after the Outstanding Warrants block (from Change 3), still inside the `<div className="space-y-3">`, add:

```tsx
            {/* Pre-funded Warrants */}
            {(() => {
              const prefundedWarrants = data.dilutionData.results
                .map((item) => toRecord(item))
                .filter((row) => {
                  const hasWarrants = getField(row, ['warrants_amount']) !== null;
                  const prefunded = toNumberValue(getField(row, ['prefunded_cost']));
                  return hasWarrants && prefunded !== null && prefunded > 0;
                });

              if (prefundedWarrants.length === 0) {
                return (
                  <div className="space-y-2">
                    <h4 className="font-medium text-zinc-300">Pre-funded Warrants</h4>
                    <p className="text-sm text-zinc-500">No pre-funded warrants found</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <h4 className="font-medium text-zinc-300">Pre-funded Warrants</h4>
                  <div className="overflow-x-hidden">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="py-2 pr-3 text-left">Details</th>
                          <th className="py-2 pr-3 text-left">Remaining</th>
                          <th className="py-2 pr-3 text-left">Pre-funded Cost</th>
                          <th className="py-2 pr-3 text-left">Registered</th>
                          <th className="py-2 pr-3 text-left">Exercisable</th>
                          <th className="py-2 pr-3 text-left">Expires</th>
                          <th className="py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prefundedWarrants.map((row, index) => {
                          const registered = String(getField(row, ['registered']) ?? '');
                          const colorClass = registered === 'Registered'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-300';
                          const status = registered === 'Registered' ? 'Registered' : 'Not Registered';

                          return (
                            <tr key={`prefunded-${index}`} className="border-b border-white/5">
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['details']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatNumber(getField(row, ['warrants_remaining']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatMoney(getField(row, ['prefunded_cost']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['registered']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['exercisable_date']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['expiration_date']))}</td>
                              <td className="py-2">
                                <span className={`rounded border px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                                  {status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
```

**Acceptance Criteria:**
- [x] Pre-funded warrants table renders below Outstanding Warrants in Dilution tab
- [x] Only warrants with `prefunded_cost > 0` shown
- [x] Green if registered, yellow if not registered
- [x] "No pre-funded warrants found" when none exist

---

### Files Changed Summary

| File | Action | Lines Added | Lines Removed | Risk |
|------|--------|-------------|---------------|------|
| `components/trading/ResearchReportSections.tsx` | MODIFY | ~160 | ~35 | LOW |
| `components/trading/ResearchCompanyHeader.tsx` | MODIFY | ~8 | 0 | LOW |
| `components/trading/ResearchTickerView.tsx` | MODIFY | ~4 | 0 | LOW |
| `components/trading/ResearchTab.tsx` | MODIFY | ~12 | ~3 | LOW |

### Verification Steps

```bash
npm run lint && npx tsc --noEmit && npm test
```

Automated validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

Manual checks:
- [ ] Load Research tab, search a ticker → header shows company name instead of "Viewing: TICKER"
- [ ] Risk tab no longer appears in the sub-tab bar
- [ ] Dilution tab shows Outstanding Warrants table with color-coded status badges
- [ ] Dilution tab shows Pre-funded Warrants section below regular warrants
- [ ] Ticker with no warrants shows "No outstanding warrants found" / "No pre-funded warrants found"
- [ ] Switching tickers resets company name to "Loading TICKER..." then updates

### Order of Implementation

1. `ResearchCompanyHeader.tsx` — add useEffect import, onCompanyName prop, useEffect call
2. `ResearchTickerView.tsx` — add onCompanyName prop, pass through, reset on fetch
3. `ResearchTab.tsx` — add companyName state, handleCompanyName callback, update display, pass callback
4. `ResearchReportSections.tsx` — remove Risk tab, add warrants + pre-funded tables to Dilution tab
5. Run `npm run lint && npx tsc --noEmit && npm test`
