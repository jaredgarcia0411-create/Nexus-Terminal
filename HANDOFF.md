# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-07
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

### Research Tab Refresh — 8 → 5 sub-pages, layout reorganization

> Generated: 2026-05-07 | Author: planning conversation (scope locked by user)
> Status: IMPLEMENTED - phases 1-10 code-validated 2026-05-07; user dev-server smoke checked 2026-05-07
> Executor: Codex

#### Goal

Condense the Research surface from 8 sub-pages to 5 (Overview, Dilution, News, Filings, Gap Stats), reorganize content so dilution detail consolidates into one tab, refresh the Overview layout with a side-by-side compact rating tile + auto-generated TLDR, and apply a set of UI cleanups (nav position, search bar, tab styles, outer container, badge styling). No new API endpoints. Company description is deferred to a follow-up PR.

#### Locked decisions (from planning conversation)

- **Q1**: `activeTab` state lives in `ResearchTickerView` (lifted from `ResearchReportSections`).
- **Q2**: Auto-TLDR uses **0ms debounce** — fire immediately on ticker change. Just abort guard + module-level `Map<string, TldrResponse>` session cache.
- **Q3**: **Skip** company description for v1. No Polygon fetch. No description slot in the layout.
- **Q4**: Keep `nasdaqCompliance` — it's already in the snapshot. Add as 7th row in `DilutionRatingTile`.
- **Q5**: Research Reports placeholder copy = `"Research Reports Coming Soon"`.
- **Q6**: S-1 filings sourced via `data.filings.filter(f => f.formType.startsWith('S-1'))`.
- **Q7**: `nasdaqCompliance` row label = `"Nasdaq Compliance"`, value = `data.nasdaqCompliance`.
- **Q8**: `DilutionRatingTile` bar-chart icons are **color-coded** (green=Low, amber=Medium, red=High). Only the text labels and borders go neutral. Use `riskDotClass`-equivalent logic to pick icon color.
- **Q9**: Reset `activeTab` to `'overview'` on ticker change.

TLDR cost is moot — Jared uses a free Groq API key.

#### Phase order (top-down execution)

Phases 1 → 10 as ordered. Each phase is self-contained and validates with `npm run lint && npx tsc --noEmit` before moving on. Phase 1 is the foundation — Phases 5, 7, 8 all depend on it.

Checkpoint 2026-05-07: phases 1-10 are implemented and code-validated. User dev-server smoke was checked with no blocking issue reported.

---

#### Phase 1 — Lift `activeTab` state + extract `ResearchSubNav`

**Goal:** Establish foundation. After this phase the app behaves identically to today — only the state location and nav markup location change.

**File:** `components/trading/ResearchSubNav.tsx`
**Action:** CREATE

1. Create new file. Generic nav bar component:
   ```tsx
   interface Props<T extends string> {
     tabs: Array<{ key: T; label: string }>;
     activeTab: T;
     onTabChange: (key: T) => void;
   }

   export default function ResearchSubNav<T extends string>({ tabs, activeTab, onTabChange }: Props<T>) {
     return (
       <div className="border-b border-white/10 px-3 py-2">
         <div className="flex flex-wrap gap-1">
           {tabs.map((tab) => (
             <button
               key={tab.key}
               type="button"
               onClick={() => onTabChange(tab.key)}
               className={`rounded px-2.5 py-1 text-sm transition-colors ${
                 activeTab === tab.key
                   ? 'bg-emerald-500 text-black'
                   : 'text-white hover:bg-white/10'
               }`}
             >
               {tab.label}
             </button>
           ))}
         </div>
       </div>
     );
   }
   ```
   Note: button styling is restyled in Phase 2; keep current classes here for Phase 1.

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Remove the local `useState<TabKey>('overview')` declaration at line 338 and any associated `useState` import if `useState` is unused elsewhere in this file (check `FilingsView` — it uses `useState` for the bucket filter, so keep the import).
2. Add `activeTab: TabKey` to the existing `Props` interface (around line 25).
3. Delete the inline nav bar JSX block at lines 368-384 entirely (the `<div className="border-b border-white/10 px-3 py-2">…</div>` block containing the tab buttons).
4. The component now receives `activeTab` as a prop and uses it directly in the conditional render blocks below.

**File:** `components/trading/ResearchTickerView.tsx`
**Action:** MODIFY

1. Add import: `import ResearchSubNav from '@/components/trading/ResearchSubNav';`
2. Add the `TabKey` type and `TABS` array at module top (mirror the 8-tab versions from `ResearchReportSections.tsx` lines 31 and 283-292):
   ```ts
   type TabKey = 'overview' | 'offering-ability' | 'dilution' | 'news' | 'filings' | 'offerings' | 'history' | 'gap-stats';

   const TABS: Array<{ key: TabKey; label: string }> = [
     { key: 'overview', label: 'Overview' },
     { key: 'offering-ability', label: 'Offering Ability' },
     { key: 'dilution', label: 'Dilution' },
     { key: 'news', label: 'News' },
     { key: 'filings', label: 'Filings' },
     { key: 'offerings', label: 'Offerings' },
     { key: 'history', label: 'History' },
     { key: 'gap-stats', label: 'Gap Stats' },
   ];
   ```
   These reduce to 5 in Phase 3.
3. Inside the component, after the `historicalDate` state, add:
   ```ts
   const [activeTab, setActiveTab] = useState<TabKey>('overview');
   useEffect(() => { setActiveTab('overview'); }, [ticker]);
   ```
4. In the JSX, render `<ResearchSubNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />` as the first child of the outermost layout `<div>` (above the 420px chart row).
5. Pass `activeTab={activeTab}` to `<ResearchReportSections />` in its existing render call.

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] All 8 tabs still render. Clicking them switches content. Nav bar now appears above the chart.
- [ ] TLDR button still works (TLDR still mounted in ResearchTickerView for now).

---

#### Phase 2 — Search bar cleanup + nav style + remove outer gray container

**File:** `components/trading/ResearchTab.tsx`
**Action:** MODIFY

1. Search input (current lines 56-64). Wrap in a relative container and add a magnifying glass icon. Replace the existing input block with:
   ```tsx
   <div className="relative">
     <svg
       className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
       fill="none"
       stroke="currentColor"
       viewBox="0 0 24 24"
       xmlns="http://www.w3.org/2000/svg"
     >
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
     </svg>
     <input
       type="text"
       value={tickerInput}
       onChange={(e) => setTickerInput(e.target.value)}
       onKeyDown={(e) => { if (e.key === 'Enter') { /* existing handler logic */ } }}
       placeholder="Search Symbol"
       className="w-48 rounded-lg border border-white/10 bg-[#121214] pl-8 pr-3 py-1.5 text-sm text-zinc-200 transition-colors focus:border-emerald-500/50 focus:outline-none"
     />
   </div>
   ```
   Preserve the existing `onChange` and `onKeyDown` handler logic from the current input. Only change `placeholder`, the className (`px-3` → `pl-8 pr-3`), and add the wrapping `<div className="relative">` + icon.
2. Delete the company name `<span>` block at lines 65-71 (`<span className="text-sm text-zinc-200">…</span>`).
3. Remove the `companyName` state declaration, the `handleCompanyName` callback, and the `onCompanyName` prop passed to `<ResearchTickerView />`. The `companyName` state existed only to feed the now-deleted span.
4. Outer container at line 74: change `<div className="h-[calc(100vh-120px)] overflow-y-auto rounded-lg border border-white/10 bg-[#121214]">` to `<div className="h-[calc(100vh-120px)] overflow-y-auto">`. Remove `rounded-lg`, `border`, `border-white/10`, `bg-[#121214]`.
5. The "no ticker selected" empty state at line 78: keep the empty `<div>` but remove the inner text "Search a ticker above or click a row in the Scanner". Replace inner content with empty (`<div className="flex h-full items-center justify-center" />` or similar). Leaves the structural placeholder without prompting copy.

**File:** `components/trading/ResearchTickerView.tsx`
**Action:** MODIFY

1. Remove the `onCompanyName?: (name: string \| null) => void;` field from the `Props` interface.
2. Remove the corresponding destructure of `onCompanyName` from props.
3. Remove the `onCompanyName?.(null)` call inside `fetchData` (start of try/fetch).
4. Remove the `onCompanyName?.(result.companyName ?? null)` call (end of try/fetch).

**File:** `components/trading/ResearchSubNav.tsx`
**Action:** MODIFY

1. Update the button className. Selected = `bg-emerald-500/10 text-emerald-500`. Unselected = `font-bold text-white hover:bg-white/10`:
   ```tsx
   className={`rounded px-2.5 py-1 text-sm transition-colors ${
     activeTab === tab.key
       ? 'bg-emerald-500/10 text-emerald-500'
       : 'font-bold text-white hover:bg-white/10'
   }`}
   ```

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] Search bar shows magnifying glass icon, placeholder reads `"Search Symbol"`.
- [ ] No company name text beside the search bar.
- [ ] No gray box border/background around the entire Research surface.
- [ ] Selected tab = translucent green text on subtle green bg. Unselected = bold white.
- [ ] No "Search a ticker above" text in the empty state.

---

#### Phase 3 — Reduce 8 tabs to 5

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Line 31: replace the `TabKey` union with:
   ```ts
   type TabKey = 'overview' | 'dilution' | 'news' | 'filings' | 'gap-stats';
   ```
2. Lines 283-292: replace the `TABS` array with:
   ```ts
   const TABS: Array<{ key: TabKey; label: string }> = [
     { key: 'overview', label: 'Overview' },
     { key: 'dilution', label: 'Dilution' },
     { key: 'news', label: 'News' },
     { key: 'filings', label: 'Filings' },
     { key: 'gap-stats', label: 'Gap Stats' },
   ];
   ```
3. Delete the entire conditional render blocks for the removed tabs:
   - `activeTab === 'offering-ability'` block (current lines 485-530)
   - `activeTab === 'offerings'` block (current lines 592-626)
   - `activeTab === 'history'` block (current lines 628-741)
   The content from these blocks is reincorporated into the new Dilution body in Phase 7. Keep the references handy.

**File:** `components/trading/ResearchTickerView.tsx`
**Action:** MODIFY

1. Update the local `TabKey` type and `TABS` array to match the 5-tab versions above.

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] Only 5 tabs appear in the nav: Overview, Dilution, News, Filings, Gap Stats.
- [ ] All 5 tabs render content. Dilution tab still shows the old sparse content (rewritten in Phase 7).
- [ ] No console errors.

---

#### Phase 4 — Build `DilutionRatingTile`

**File:** `components/trading/DilutionRatingTile.tsx`
**Action:** CREATE

1. Create new file. Component shows 7 rows: Ofr. Ability, Ofr. Freq., Dilution, Cash Need, Overall Ofr. Risk, Warrant Exercise, Nasdaq Compliance. Bar-chart icon is color-coded by risk; text and borders are neutral.
   ```tsx
   import { toStringValue } from '@/lib/askedgar-utils';

   interface Props {
     offeringAbilityRating: string | null;
     offeringFrequencyRating: string | null;
     dilutionRating: string | null;
     cashNeedRating: string | null;
     overallRisk: string | null;
     warrantExerciseRating: string | null;
     nasdaqCompliance: string | null;
   }

   function iconColorClass(value: string | null): string {
     if (!value) return 'text-zinc-500';
     const v = value.toLowerCase();
     if (v.includes('low') || v.includes('compliant') || v.includes('positive')) return 'text-emerald-500';
     if (v.includes('medium') || v.includes('watch') || v.includes('warning')) return 'text-amber-500';
     if (v.includes('high') || v.includes('non-compliant') || v.includes('risk')) return 'text-rose-500';
     return 'text-zinc-500';
   }

   function BarChartIcon({ colorClass }: { colorClass: string }) {
     return (
       <svg className={`h-3 w-3 ${colorClass}`} fill="currentColor" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
         <rect x="1" y="7" width="2" height="4" />
         <rect x="5" y="4" width="2" height="7" />
         <rect x="9" y="1" width="2" height="10" />
       </svg>
     );
   }

   export default function DilutionRatingTile(props: Props) {
     const rows = [
       { label: 'Ofr. Ability', value: props.offeringAbilityRating },
       { label: 'Ofr. Freq.', value: props.offeringFrequencyRating },
       { label: 'Dilution', value: props.dilutionRating },
       { label: 'Cash Need', value: props.cashNeedRating },
       { label: 'Overall Ofr. Risk', value: props.overallRisk },
       { label: 'Warrant Exercise', value: props.warrantExerciseRating },
       { label: 'Nasdaq Compliance', value: props.nasdaqCompliance },
     ];

     return (
       <div>
         <h4 className="mb-2 text-sm font-semibold text-zinc-200">Dilution Rating</h4>
         <div className="space-y-1.5">
           {rows.map((row) => (
             <div key={row.label} className="flex items-center justify-between gap-2">
               <span className="text-xs text-zinc-400">{row.label}</span>
               <div className="flex items-center gap-2">
                 <BarChartIcon colorClass={iconColorClass(row.value)} />
                 <span className="text-xs font-medium text-zinc-200">{toStringValue(row.value)}</span>
               </div>
             </div>
           ))}
         </div>
       </div>
     );
   }
   ```

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] Component compiles. Not yet rendered anywhere; smoke check happens in Phase 5.

---

#### Phase 5 — Rewrite Overview tab

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Add imports at top of file:
   ```ts
   import DilutionRatingTile from '@/components/trading/DilutionRatingTile';
   import ResearchTldr from '@/components/trading/ResearchTldr';
   ```
2. Confirm `ticker: string` is already in the `Props` interface (verify line ~26). It is.
3. Remove the now-unused computed variables that fed the old Overview block:
   - `ratings` array (current lines 344-351)
   - `hasRatings` flag (line ~352)
   - `hasCashPosition` flag — keep it; reused in Phase 7
   - `hasMarketStats` flag (line ~358) and any related code
4. Replace the entire `activeTab === 'overview'` conditional block (current lines 387-483) with the new layout:
   ```tsx
   {activeTab === 'overview' ? (
     <div className="space-y-5 p-3">
       <div className="flex gap-4">
         <div className="w-64 shrink-0">
           <DilutionRatingTile
             offeringAbilityRating={data.offeringAbilityRating}
             offeringFrequencyRating={data.offeringFrequencyRating}
             dilutionRating={data.dilutionRating}
             cashNeedRating={data.cashNeedRating}
             overallRisk={data.overallRisk}
             warrantExerciseRating={data.warrantExerciseRating}
             nasdaqCompliance={data.nasdaqCompliance}
           />
         </div>
         <div className="min-w-0 flex-1">
           <ResearchTldr ticker={ticker} />
         </div>
       </div>

       <div>
         <h4 className="mb-2 text-sm font-semibold text-zinc-200">Research Reports</h4>
         <div className="rounded border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-zinc-500">
           Research Reports Coming Soon
         </div>
       </div>
     </div>
   ) : null}
   ```

**File:** `components/trading/ResearchTickerView.tsx`
**Action:** MODIFY

1. Remove the `<ResearchTldr ticker={ticker} />` mount (currently in a `border-t border-white/10` wrapper around lines 111-113). TLDR now lives inside the Overview tab body.
2. Remove the `import ResearchTldr from '@/components/trading/ResearchTldr';` line.

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] Overview tab shows: side-by-side row with `DilutionRatingTile` (left, fixed width) and `ResearchTldr` (right, flex-1). Below: Research Reports placeholder card with "Research Reports Coming Soon".
- [ ] No Market Stats grid anywhere on Overview.
- [ ] Switching to Dilution/News/Filings/Gap Stats hides the TLDR and Research Reports placeholder.
- [ ] Switching back to Overview re-shows them.

---

#### Phase 6 — Auto-TLDR refactor

**File:** `components/trading/ResearchTldr.tsx`
**Action:** MODIFY (full rewrite)

1. Replace the file content. Key changes:
   - Module-level `const tldrCache = new Map<string, TldrResponse>();` (declared outside the component function so it persists across remounts during the session).
   - `useEffect` on `ticker` that fires the fetch immediately (no `setTimeout`/debounce).
   - `AbortController` ref to cancel in-flight requests on ticker change.
   - Remove the Generate button + "Click 'Generate TLDR'" prompt.
   - Merge the existing `actionSteps` (Watch For) and `risks` lists into a single "Watch For & Risks" section. Use `•` bullet character. All items rendered with `text-zinc-300` (no color coding).

   Replace the file body with:
   ```tsx
   'use client';

   import { useEffect, useRef, useState } from 'react';

   interface TldrResponse {
     ticker: string;
     tldr: string;
     findings: string[];
     actionSteps: string[];
     risks: string[];
     historicalContext?: string | null;
     hasHistoricalData?: boolean;
     generatedAt: string;
   }

   const tldrCache = new Map<string, TldrResponse>();

   interface Props {
     ticker: string;
   }

   export default function ResearchTldr({ ticker }: Props) {
     const [data, setData] = useState<TldrResponse | null>(null);
     const [loading, setLoading] = useState(false);
     const [error, setError] = useState<string | null>(null);
     const abortRef = useRef<AbortController | null>(null);

     useEffect(() => {
       if (!ticker) return;

       const cached = tldrCache.get(ticker);
       if (cached) {
         setData(cached);
         setError(null);
         setLoading(false);
         return;
       }

       abortRef.current?.abort();
       const controller = new AbortController();
       abortRef.current = controller;
       setLoading(true);
       setError(null);
       setData(null);

       fetch('/api/askedgar/tldr', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ ticker }),
         signal: controller.signal,
       })
         .then((res) => {
           if (!res.ok) throw new Error(`TLDR request failed: ${res.status}`);
           return res.json() as Promise<TldrResponse>;
         })
         .then((result) => {
           tldrCache.set(ticker, result);
           setData(result);
         })
         .catch((err: unknown) => {
           if (err instanceof Error && err.name === 'AbortError') return;
           setError(err instanceof Error ? err.message : 'TLDR generation failed');
         })
         .finally(() => {
           if (controller.signal.aborted) return;
           setLoading(false);
         });

       return () => {
         controller.abort();
       };
     }, [ticker]);

     if (loading) {
       return <div className="text-sm text-zinc-500">Generating TLDR…</div>;
     }
     if (error) {
       return <div className="text-sm text-rose-400">{error}</div>;
     }
     if (!data) {
       return null;
     }

     const watchAndRisks = [...(data.actionSteps ?? []), ...(data.risks ?? [])];

     return (
       <div className="space-y-4">
         <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
           <p className="text-sm text-zinc-200">{data.tldr}</p>
         </div>

         {data.findings && data.findings.length > 0 ? (
           <div>
             <h4 className="mb-2 text-sm font-semibold text-zinc-200">Key Findings</h4>
             <ul className="space-y-1">
               {data.findings.map((item, i) => (
                 <li key={i} className="text-sm text-zinc-300">• {item}</li>
               ))}
             </ul>
           </div>
         ) : null}

         {watchAndRisks.length > 0 ? (
           <div>
             <h4 className="mb-2 text-sm font-semibold text-zinc-200">Watch For &amp; Risks</h4>
             <ul className="space-y-1">
               {watchAndRisks.map((item, i) => (
                 <li key={i} className="text-sm text-zinc-300">• {item}</li>
               ))}
             </ul>
           </div>
         ) : null}
       </div>
     );
   }
   ```

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] Selecting a ticker fires the TLDR call automatically (no button visible). "Generating TLDR…" shows briefly, then result renders.
- [ ] Selecting the same ticker again shows the cached result instantly (no spinner, no network call — verify in DevTools Network tab).
- [ ] Selecting a different ticker mid-flight aborts the previous call (verify in DevTools).
- [ ] Watch For & Risks renders as one section with `•` bullets, all `text-zinc-300`. No colored amber/rose text.

---

#### Phase 7 — Rewrite Dilution tab

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Replace the entire `activeTab === 'dilution'` conditional block (current lines 532-561, now reduced after Phase 3) with the consolidated 11-section layout. Source content from the previously deleted blocks (kept handy for Phase 7).
2. Wrap in `<div className="space-y-6 p-3">`. Each section uses `<h4 className="mb-2 text-base font-semibold text-zinc-200">` for section headers (Offering Risks uses `font-bold` to match the spec emphasis).
3. Section order and content sources:

   **1. Offering Risks** — header + 4-card grid from the old Dilution block (current lines 541-555). Header className: `text-base font-bold text-zinc-200`. Cards: Warrants / Convertibles / Auth Shares / Available, sourced from `data.dilutionDetails.{warrantInfo, convertibles, authorizedShares, sharesAvailable}`.

   **2. Cash Position** — port the prose block from old Overview (lines 410-419). Recompute `hasCashPosition` inline. Heading "Cash Position" + the "X months of cash left based on quarterly burn $Y and estimated cash $Z" sentence, fields from `data.dilutionDetails.{cashRemainingMonths, cashBurn, estimatedCash}`.

   **3. Financial Commentary** — Use the simpler Offering Ability format (previously lines 525-528):
   ```tsx
   <div>
     <h4 className="mb-2 text-base font-semibold text-zinc-200">Financial Commentary</h4>
     <p className="text-sm text-zinc-200">{toStringValue(data.dilutionDetails.managementCommentary)}</p>
   </div>
   ```

   **4. Split History** — combines 4 sub-tables from old History block:
   - Historical Float table (was lines 630-655) under sub-heading `Historical Float`
   - Reverse Splits table (was 657-678) under `Reverse Splits`
   - Split Status table (was 680-712) under `Split Status`
   - Agreements table (was 714-739) under `Agreements`

   Wrap all four under one `<h4>Split History</h4>` parent header. Sub-headings use `text-sm font-medium text-zinc-300`.

   **5. S-1's** — Filter from `data.filings`:
   ```tsx
   <div>
     <h4 className="mb-2 text-base font-semibold text-zinc-200">S-1's</h4>
     <FilingsTable rows={data.filings.filter(f => f.formType.startsWith('S-1'))} />
   </div>
   ```
   (`FilingsTable` is the existing helper used by `FilingsView`; if it isn't directly accessible, render the same column structure inline — Type, Headline link, Filed At.)

   **6. Shelfs** — port the shelf registrations table from old Offering Ability block (was lines 491-523). Header "Shelfs". Same column structure (Headline / ATM / Amount / Remaining / Baby Shelf / Filed).

   **7. ATM's** — `<ProgramSection title="ATM Programs" rows={atmRegistrations} />`. The `atmRegistrations` constant is `data.registrations.filter(r => r.isAtm === true)` — verify the existing definition still lives in this file; preserve it.

   **8. Equity Lines** — `<ProgramSection title="Equity Lines" rows={data.equityLines} />`.

   **9. Warrants** — both existing `<WarrantSection>` calls:
   - `<WarrantSection title="Outstanding Warrants" rows={regularWarrants} />`
   - `<WarrantSection title="Pre-funded Warrants" rows={prefundedWarrants} />`

   `regularWarrants` and `prefundedWarrants` constants must still exist near the top of the component — preserve them.

   **10. Past Offerings** — port the offerings table from old Offerings block (was lines 594-626). Wrap under `<h4>Past Offerings</h4>`. Columns: Date / Type / Shares / Price / Amount.

   **11. Owners** — port the ownership groups section from old Overview (was lines 432-467). Wrap under `<h4>Owners</h4>`. Multiple tables, one per `data.ownershipGroups[]`, each with reported date + columns Name / Role / Common / Preferred / Options / Warrants.

4. Remove the standalone `dilutionRating` badge row (was lines 534-539) — the rating is now visible in the Overview `DilutionRatingTile` and the 4-card grid covers Offering Risks.

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] Dilution tab renders all 11 sections in the listed order with no console errors.
- [ ] Empty/missing data shows `NoDataBadge` (where existing code uses it) — no blank holes.
- [ ] Spot-check a ticker with rich dilution data (any biotech micro-cap) — every section populates.

---

#### Phase 8 — Conditional chart rendering

**File:** `components/trading/ResearchTickerView.tsx`
**Action:** MODIFY

1. Locate the 420px-height row that contains `<ResearchCompanyHeader />` and `<ResearchChart />` (currently around lines 96-107). The chart side currently always renders.
2. Wrap the chart container with a conditional. Replace the current chart `<div className="min-h-0 flex-1 bg-[#0A0A0B]">` block with:
   ```tsx
   {(activeTab === 'overview' || activeTab === 'gap-stats') ? (
     <div className="min-h-0 flex-1 bg-[#0A0A0B]">
       <ResearchChart {/* preserve existing props */} />
     </div>
   ) : null}
   ```
3. Make the row height conditional so the company header doesn't sit alone in a 420px box on chart-less tabs:
   ```tsx
   <div className={`flex shrink-0 border-b border-white/10 ${(activeTab === 'overview' || activeTab === 'gap-stats') ? 'h-[420px]' : ''}`}>
   ```
   When the chart is hidden, the row collapses to the natural height of `ResearchCompanyHeader`.

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass.
- [ ] Chart renders on Overview tab.
- [ ] Chart renders on Gap Stats tab. Clicking a date row in the Gap Stats table still updates the chart correctly.
- [ ] Chart is absent on Dilution, News, and Filings tabs. Company header collapses naturally — no big empty 420px box.

---

#### Phase 9 — Strip residual badge color/border

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Audit remaining calls to `riskClass()` and `riskDotClass()` after Phases 5 and 7. Most should be gone.
2. If any badge calls remain in the active code path that should be neutral per spec (Dilution Risk / High / Medium / Low text in any surviving location), replace `className={riskClass(value)}` with plain `className="text-sm text-zinc-200"` (no border, no bg, no colored text).
3. Leave alone: `WarrantSection` status pills (use `getWarrantStatus().colorClass`, intentionally colored) and `ProgramSection` Active/Inactive badges (inline classes, intentional).
4. If `riskClass` and/or `riskDotClass` are no longer called anywhere in this file, remove them from the import line:
   ```ts
   import { babyShelfBadge, detectFormType, formatDate, formatMoney, formatNumber, getWarrantStatus, riskClass, riskDotClass, toStringValue } from '@/lib/askedgar-utils';
   ```
5. Same audit for `detectFormType` — if unused in the active code path, remove from the import.

**Validation:**
- [ ] `npm run lint && npx tsc --noEmit` pass with no unused-import warnings.
- [ ] No colored Dilution Risk badges in the new Overview/Dilution surfaces. Warrant status pills and ATM/Equity Active badges keep their colors (intentional).

---

#### Phase 10 — Final cleanup pass

1. `components/trading/ResearchReportSections.tsx`: confirm the `ticker` prop is still actively used (it feeds the `<ResearchTldr ticker={ticker} />` in the Overview block). If not, remove from `Props` and from the call site in `ResearchTickerView.tsx`. (It IS used — verify, don't remove.)
2. `components/trading/ResearchTickerView.tsx`: confirm the local `TabKey` and `TABS` definitions match `ResearchReportSections.tsx` exactly (5 tabs, identical labels). Optional cleanup: export `TabKey` and `TABS` from `ResearchReportSections.tsx` and import them in `ResearchTickerView.tsx` to dedupe. Skip if it complicates the diff.
3. `components/trading/ResearchTab.tsx`: confirm `companyName` state, `handleCompanyName` callback, and `onCompanyName` prop chain are fully removed (Phase 2). No remnants.
4. Run from repo root:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run typecheck:services` only if any `services/` files were touched (none expected)

**Validation:**
- [ ] All four commands pass with zero errors and zero warnings.

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `components/trading/ResearchSubNav.tsx` | CREATE — generic nav bar component | Low |
| `components/trading/DilutionRatingTile.tsx` | CREATE — 7-row compact rating tile with color-coded bar-chart icons | Low |
| `components/trading/ResearchTab.tsx` | Search bar magnifying glass + "Search Symbol", drop company-name span, drop gray container, drop empty-state copy, remove `companyName` state + `onCompanyName` chain | Med |
| `components/trading/ResearchTickerView.tsx` | Lift `activeTab` state, mount `ResearchSubNav`, conditional chart rendering, remove TLDR mount, remove `onCompanyName` prop | Med |
| `components/trading/ResearchReportSections.tsx` | Remove inline nav, accept `activeTab` prop, reduce TabKey 8→5, full Overview rewrite, full Dilution rewrite (11 sections), strip residual `riskClass` usage, clean unused imports | High |
| `components/trading/ResearchTldr.tsx` | Full rewrite: auto-fire on ticker change, abort guard, module-level Map cache, merge Watch For + Risks into one bullet list, drop colored text | Med |

#### Verification

Checkpoint validation completed from repo root on 2026-05-07 after phases 1-7:
- `npm run lint` - passed after each phase 1-7
- `npx tsc --noEmit` - passed after each phase 1-7
- `npx vitest run __tests__/research-tab.test.tsx` - passed (4 tests)
- `npm test` - passed (84 files / 612 tests)
- `npm run typecheck:services` - not run; no `services/` files were touched
- Manual browser smoke - user checked via dev server; no blocking issue reported

Final validation completed from repo root on 2026-05-07 after phases 8-10:
- `npm run lint` - passed
- `npx tsc --noEmit` - passed
- `npm test` - passed (84 files / 612 tests)
- `npm run typecheck:services` - not run; no `services/` files were touched
- Manual browser smoke - user checked via dev server; no blocking issue reported

Run from repo root after each phase, and again at the end:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run typecheck:services` only if any `services/` files were touched (none expected here)

Manual smoke (cannot be auto-verified — flag in completion report):
- Search a ticker (any micro-cap with rich dilution data, e.g., a biotech). Snapshot loads.
- All 5 tabs appear in order: Overview → Dilution → News → Filings → Gap Stats.
- Sub-page nav sits directly below the search bar (above the chart row).
- Selected tab is translucent green text on subtle green bg; unselected is bold white.
- Search bar shows magnifying glass icon and "Search Symbol" placeholder. No company name text beside it.
- No gray box/border around the entire Research surface.
- Overview: chart visible at top; below it, side-by-side row with `DilutionRatingTile` (7 rows including Nasdaq Compliance, color-coded bar-chart icons, neutral text) on the left and auto-generated TLDR on the right; Research Reports placeholder ("Research Reports Coming Soon") below.
- TLDR fires immediately on ticker load (no button). Re-selecting the same ticker shows the cached result instantly (verify Network tab — no second POST to `/api/askedgar/tldr`).
- TLDR Watch For & Risks: single section, `•` bullets, all neutral zinc text.
- Market Stats grid is gone everywhere.
- Dilution tab: scroll through 11 sections in order: Offering Risks → Cash Position → Financial Commentary → Split History (Historical Float + Reverse Splits + Split Status + Agreements) → S-1's → Shelfs → ATM's → Equity Lines → Warrants → Past Offerings → Owners. All populate or show NoDataBadge.
- Chart is hidden on Dilution, News, Filings tabs. Company header row collapses to natural height.
- Chart visible on Gap Stats tab; clicking a date row updates the chart to that date's intraday view.
- News tab unchanged structurally; Filings tab unchanged structurally; Gap Stats tab unchanged structurally.
- Switching tickers resets active tab to Overview.
- No JavaScript console errors on any tab.

#### Out of scope

- Adding company description (deferred to v2 — pick a source first).
- Wiring the Research Reports placeholder to real data.
- Deleting `ResearchGainersList.tsx` (dead code, but out of scope for this refresh).
- Refactoring `lib/research.ts` `fetchAndCacheRawReport` (likely orphaned, but unchanged scope).
- Persisting `activeTab` across sessions (intentional reset on ticker change).
- Adding tests for `DilutionRatingTile` or the auto-TLDR cache (small enough to skip).

---

## Recently Completed Summary

- 2026-05-07: UI Cleanup Pass shipped — Trading Journal calendar always-on with bigger fonts; Trade Detail popout polish (white section titles, dividers, no duplicate Notes label); Trade Replay rows lose checkboxes only in journal context (preserves click-through and tag editing); Backtesting review surface centered max-width with 4×2 stats grid including new `Total Return (R)` and `Avg Hold Time` boxes; sample-set deletion uses Trash2 icon; New Backtest dialog gates Create on explicit sample-set selection (System Sheet remains a valid choice via sentinel-based gating). Validated with `npm run lint`, `npx tsc --noEmit`, `npm test` (84 files / 612 tests), `npm run workflow:audit`.
- 2026-05-05: Dashboard scanner completion — split PM/AH gainers scan with combined volume gating, MDR scanner with `mdr_triggers` table + nightly cron + dashboard merging of live and recent rows. Threshold values render as prices/percentages.
- 2026-05-04: Backtesting UI refinements plus grid layout and sample-set sidebar (`b03fa38`, `82bfa46`, `10e1071`, `82cca14`, `36a410b`).
- 2026-05-03: Backtesting chart drawing/indicator persistence and review save-flow fixes (`82cbb55`, `88a4da4`, `6513e40`).
- 2026-05-01: Backtest Manager landing page shipped: schema, API, manager, stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred. Data is not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
- Research tab company description: deferred to a v2 pass. Pick a source (Polygon `/v3/reference/tickers` returns a usable description) before wiring.
