# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-20
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20). See git history for full records.

## Current State

**Active spec:** None. `Tighten Trading Journal UI` completed on 2026-04-20; next up remains approval gates + spend enforcement from `FUTURE-PLANS.md`.

Next up after this ships: approval gates + spend enforcement from `FUTURE-PLANS.md`.

## Validation Snapshot

Most recent validation (`2026-04-20`, Tighten Trading Journal UI):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`52` files, `402` tests)

## Follow-Up Notes

- Production check: after deploy, verify `GET /api/cron/agent-retention` returns `200` when called with the existing project `CRON_SECRET`.
- After first production run of the refined research agents, confirm a Discord embed renders the gap table for a ticker with gap history and the "No historical gap data available." fallback for a ticker without — this was the bug the refactor targeted.

---

## Tighten Trading Journal UI

> Generated: 2026-04-20 | Agent: nexus-architect (inline by plan agent)
> Status: COMPLETED (implemented and validated on 2026-04-20)

### Goal

Polish four items on the Trading Journal surface:
1. Fade the embedded Trading Calendar in/out when its accordion toggles.
2. Remove the redundant inner card chrome (border + "Trading Calendar" title) on the TradingCalendar when embedded inside JournalTab, while keeping it intact on the Dashboard.
3. Replace the duplicate text-form "R by Day" field in the Weekly Review with a "Total for the week" summary auto-field.
4. Add seven reflection text boxes to the Weekly Review default template.

No DB migration, no API change, no Zod change — `weekly_reviews.reportData` is already flexible `jsonb` and `upsertWeeklyReviewSchema` accepts `z.record(z.string(), z.unknown())`.

### Confirmed decisions (locked by user)

1. "Total for the week" auto-field renders as `"Net $1,234.56 · +2.35R · 12 trades"`.
2. The 7 new reflection questions are `type: 'text'` (3-row textarea via TemplateFieldRenderer).
3. No auto-migration for users with saved custom weekly templates — they click "Reset to Defaults" to pick up the new fields.
4. Keep the month label + prev/next chevron nav visible when TradingCalendar is embedded in JournalTab.

---

### Phase 1 — Fade transition on the Trading Calendar accordion

**File:** `components/trading/JournalTab.tsx`
**Action:** MODIFY

1. Locate the accordion body at lines 159-167:
   ```tsx
   {calendarOpen ? (
     <div className="px-4 pb-4">
       <TradingCalendar
         trades={filteredTrades}
         onDayClick={(dateKey) => setDrcDate(dateKey)}
         onWeekClick={(start, end) => setWeekRange({ start, end })}
       />
     </div>
   ) : null}
   ```
2. Replace that block with an `AnimatePresence` + `motion.div` wrapper that mirrors the day-card fade at lines 276-284 of this same file. The result should read:
   ```tsx
   <AnimatePresence mode="wait">
     {calendarOpen ? (
       <motion.div
         key="calendar-open"
         initial={{ opacity: 0, y: 10 }}
         animate={{ opacity: 1, y: 0 }}
         exit={{ opacity: 0, y: -10 }}
         transition={{ duration: 0.2, ease: "easeInOut" }}
         className="px-4 pb-4"
       >
         <TradingCalendar
           trades={filteredTrades}
           onDayClick={(dateKey) => setDrcDate(dateKey)}
           onWeekClick={(start, end) => setWeekRange({ start, end })}
           embedded
         />
       </motion.div>
     ) : null}
   </AnimatePresence>
   ```
3. Note the added `embedded` prop on `<TradingCalendar>` — that's required by Phase 2. Do not forget it.
4. `motion` and `AnimatePresence` are already imported at the top of this file (they power the day-card and tab-level fades). No new imports needed.

**Expected behavior after this change:** clicking the "Trading Calendar" header toggles the body with the same 0.2s opacity + translateY easeInOut transition used on the day cards.

**Acceptance criteria:**
- [x] Opening the accordion runs opacity 0→1 and y 10→0 over 0.2s.
- [x] Closing the accordion runs opacity 1→0 and y 0→-10 over 0.2s.
- [x] `<TradingCalendar>` is rendered with `embedded` prop (no other call site is changed).
- [x] `lint` and `tsc` pass.

---

### Phase 2 — Strip redundant inner card from TradingCalendar when embedded

**File:** `components/trading/TradingCalendar.tsx`
**Action:** MODIFY

1. Extend the props interface at lines 23-27 by adding an optional `embedded` flag:
   ```ts
   interface TradingCalendarProps {
     trades: Trade[];
     onDayClick?: (dateKey: string) => void;
     onWeekClick?: (weekStart: string, weekEnd: string) => void;
     embedded?: boolean;
   }
   ```
2. Update the component signature at line 35 to destructure with a default:
   ```ts
   export default function TradingCalendar({ trades, onDayClick, onWeekClick, embedded = false }: TradingCalendarProps) {
   ```
3. Locate the inner card wrapper at line 103:
   ```tsx
   <div className="bg-[#121214] border border-white/5 rounded-2xl p-6">
   ```
   Replace with a conditional className — when `embedded`, use an empty wrapper that keeps layout semantics but drops chrome:
   ```tsx
   <div className={embedded ? '' : 'bg-[#121214] border border-white/5 rounded-2xl p-6'}>
   ```
4. Locate the header row at line 104:
   ```tsx
   <div className="flex items-center justify-between mb-8">
   ```
   Swap the bottom margin based on `embedded` (`mb-4` when embedded, `mb-8` when standalone):
   ```tsx
   <div className={`flex items-center justify-between ${embedded ? 'mb-4' : 'mb-8'}`}>
   ```
5. Locate the title at line 105:
   ```tsx
   <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Trading Calendar</h3>
   ```
   Wrap it so it renders only when not embedded. To keep the month label + chevron nav anchored to the right in embedded mode, use a leading spacer `div` when the title is hidden:
   ```tsx
   {embedded ? <div /> : (
     <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Trading Calendar</h3>
   )}
   ```
6. Leave lines 106-116 (month label + prev/next chevron buttons) untouched — they render in both modes.
7. Do not change anything below line 117 (calendar grid, weekly column, selected-date dropdown, RBarStrip-equivalent hover logic).

**Do NOT touch:** `components/trading/DashboardTab.tsx:185` — that site calls `<TradingCalendar trades={filteredTrades} />` without `embedded`, so `embedded` defaults to `false` and the Dashboard view renders exactly as it does today.

**Expected behavior after this change:**
- In JournalTab (embedded), the calendar renders without an extra rounded background or border, without the "Trading Calendar" uppercase label, but with the month label + prev/next chevrons anchored to the right.
- In DashboardTab (standalone), nothing changes visually.

**Acceptance criteria:**
- [x] `TradingCalendarProps` includes `embedded?: boolean`.
- [x] Default value for `embedded` is `false`.
- [x] When `embedded` is true, no outer `bg-[#121214] border border-white/5 rounded-2xl p-6` wrapper is rendered, the `<h3>` title is absent, and the header row uses `mb-4`.
- [x] When `embedded` is false, all three styles above are present exactly as before.
- [x] DashboardTab.tsx is unmodified.
- [x] `lint` and `tsc` pass.

---

### Phase 3 — Replace second "R by Day" with "Total for the week"

**File:** `lib/journal-template-defaults.ts`
**Action:** MODIFY

1. Locate line 22:
   ```ts
   { id: 'perDayR', label: 'R by day', type: 'auto', required: false },
   ```
   Replace with:
   ```ts
   { id: 'weeklyTotal', label: 'Total for the week', type: 'auto', required: false },
   ```
   Do not touch the other four default entries on lines 23-26 yet — they're addressed in Phase 4.

**File:** `components/trading/WeeklyReviewSheet.tsx`
**Action:** MODIFY

2. Update the top-of-file imports. Find the existing import line:
   ```ts
   import { aggregateWeek } from '@/lib/journal-aggregates';
   ```
   Replace with (split the value import and type import to keep it explicit):
   ```ts
   import { aggregateWeek, type WeekAggregate } from '@/lib/journal-aggregates';
   ```
3. Add a new import for `formatCurrency`. Insert anywhere near the other `@/lib/*` imports at the top of the file:
   ```ts
   import { formatCurrency } from '@/lib/trading-utils';
   ```
4. Delete the `formatPerDayR` helper at lines 318-322:
   ```ts
   function formatPerDayR(perDayR: { date: string; r: number }[]): string {
     return perDayR
       .map(({ date, r }) => `${date}: ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`)
       .join('  |  ');
   }
   ```
   Replace it (same location) with:
   ```ts
   function formatWeeklyTotal(agg: WeekAggregate): string {
     const net = formatCurrency(agg.netResult);
     const rSigned = `${agg.rTotal >= 0 ? '+' : ''}${agg.rTotal.toFixed(2)}R`;
     const tradeCount = agg.tradeIds.length;
     return `Net ${net} · ${rSigned} · ${tradeCount} trade${tradeCount === 1 ? '' : 's'}`;
   }
   ```
5. Update the first call site inside the `useEffect` (currently line 91):
   ```ts
   if (merged.perDayR == null) merged.perDayR = formatPerDayR(agg.perDayR);
   ```
   Replace with:
   ```ts
   if (merged.weeklyTotal == null) merged.weeklyTotal = formatWeeklyTotal(agg);
   ```
6. Update the second call site (currently line 95):
   ```ts
   setReportData({ perDayR: formatPerDayR(agg.perDayR) });
   ```
   Replace with:
   ```ts
   setReportData({ weeklyTotal: formatWeeklyTotal(agg) });
   ```
7. Do NOT touch anything inside the `RBarStrip` function (lines 324-349) or its invocation on line 219 — that visual bar chart is the one "R by Day" we keep.
8. Do NOT touch the `<TemplateFieldRenderer>` loop at lines 289-297 — it is field-id agnostic and will pick up the renamed field automatically.

**Expected behavior after this change:**
- Opening a new (unsaved) weekly review shows the bar-chart "R by Day" at the top, then a read-only "Total for the week" auto-field in the form body containing a string like `Net -$2,744.99 · -4.57R · 14 trades`.
- Opening a previously-saved weekly review uses its own `templateSnapshot`, so legacy reviews continue to render with their old field list unchanged (stale `perDayR` key in `reportData` is cosmetic, not a regression).

**Acceptance criteria:**
- [x] `WEEKLY_DEFAULT_FIELDS[0]` is `{ id: 'weeklyTotal', label: 'Total for the week', type: 'auto', required: false }`.
- [x] `formatPerDayR` is removed from `WeeklyReviewSheet.tsx`.
- [x] `formatWeeklyTotal` exists and is pure.
- [x] Both `reportData` bootstrapping sites write `weeklyTotal`, not `perDayR`.
- [x] `RBarStrip` and its call site are byte-identical to before.
- [x] `lint` and `tsc` pass.

---

### Phase 4 — Add seven reflection text boxes

**File:** `lib/journal-template-defaults.ts`
**Action:** MODIFY

1. Append the following seven entries to `WEEKLY_DEFAULT_FIELDS` after the existing `goalsNextWeek` entry (the last entry in the array). Keep this exact order and keep the trailing closing bracket of the array on its own line:
   ```ts
   { id: 'enterTooSoon',      label: 'Did you enter trades too soon?',        type: 'text', required: false },
   { id: 'tookProfitTooLate', label: 'Did you take profit too late?',         type: 'text', required: false },
   { id: 'stopsTooTight',     label: 'Were stops too tight?',                 type: 'text', required: false },
   { id: 'poorRiskReward',    label: 'Did you take poor risk/reward trades?', type: 'text', required: false },
   { id: 'riskTooMuch',       label: 'Did you risk too much?',                type: 'text', required: false },
   { id: 'riskTooLittle',     label: 'Did you risk too little?',              type: 'text', required: false },
   { id: 'missedTrades',      label: 'Did you miss any trades?',              type: 'text', required: false },
   ```
   After this change `WEEKLY_DEFAULT_FIELDS` should contain 12 entries in this order: `weeklyTotal`, `whatWorked`, `whatDidnt`, `cycleNotes`, `goalsNextWeek`, then the seven new questions above.
2. No other files. `reportData` is flexible `jsonb`, `upsertWeeklyReviewSchema` already accepts `z.record(z.string(), z.unknown())`, and `TemplateFieldRenderer` already renders `type: 'text'` as a 3-row textarea.

**Expected behavior after this change:**
- A brand-new weekly review sheet shows the four existing text questions followed by the seven new reflection textareas, each rendering the label above an empty 3-row textarea.
- Saving the review persists answers under their new field ids in `weekly_reviews.reportData`.
- Reopening the saved review rehydrates the answers.

**Acceptance criteria:**
- [x] `WEEKLY_DEFAULT_FIELDS` has 12 entries in the specified order.
- [x] Every new entry has `type: 'text'` and `required: false`.
- [x] `lint` and `tsc` pass.

---

### Files Changed Summary

| File | Action | Approx. lines changed | Risk |
|---|---|---|---|
| `components/trading/JournalTab.tsx` | MODIFY | ~14 (replace one JSX block + add one prop) | LOW |
| `components/trading/TradingCalendar.tsx` | MODIFY | ~8 (new prop, 3 conditional classNames) | LOW |
| `components/trading/WeeklyReviewSheet.tsx` | MODIFY | ~10 (swap helper, update 2 call sites, add 1 import, split 1 import) | LOW |
| `lib/journal-template-defaults.ts` | MODIFY | ~8 (rename 1 entry, append 7 entries) | LOW |

No files created, no files deleted, no migration, no API change, no Zod change.

---

### Verification Steps

From repo root `/home/jared/Nexus-Terminal`:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

Skip `npm run typecheck:services` — no files under `services/` are touched. Skip `npm run workflow:audit` — no workflow assets changed.

**Manual smoke test:**
1. Open the Journal tab → click the "Trading Calendar" accordion header → confirm the calendar fades in with opacity+y motion over ~0.2s.
2. Click the header again → confirm the calendar fades out.
3. Inside the open accordion, confirm there is no inner rounded border and no "TRADING CALENDAR" uppercase title; the "April 2026" label and prev/next chevrons are still visible and functional.
4. Switch to the Dashboard tab → confirm the `TradingCalendar` there still has its original rounded-2xl card + "Trading Calendar" title (unchanged).
5. Click a weekly "REVIEW" cell → the Weekly Review sheet opens → confirm exactly one "R by Day" bar chart at the top and one read-only "Total for the week" auto-field in the form body showing `Net $X · ±Y.YYR · N trade(s)`.
6. Below the four original text fields (`What worked`, `What didn't work`, `Cycle notes`, `Goals next week`) confirm the seven new reflection textareas render in the documented order, each with an empty 3-row textarea.
7. Type into a few of the new textareas → click Save → toast appears → reopen the same week → answers are rehydrated.
8. Navigate to the Archive tab → open a previously-saved weekly review → confirm it still renders from its own `templateSnapshot` (it will show the old `perDayR` field, no new reflection fields — this is correct, historical reviews use their own snapshot).

---

### Open Questions for Codex

None — the plan is locked.
