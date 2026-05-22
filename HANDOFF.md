# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-22
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

---

## Sprint 3 — Visual Light Mode (Full Token Migration)

> Generated: 2026-05-22 | Agent: Claude (Plan)
> Status: READY FOR CODEX

### Objective

Make light mode actually look like light mode. Sprint 2 wired the infrastructure (next-themes provider, `:root` + `.dark` blocks in `globals.css`, both currently identical dark palettes). This sprint defines the real light palette, migrates ~824 hardcoded color utilities and ~30 hardcoded hex containers across `app/` and `components/` to the existing semantic tokens (`bg-background`, `text-foreground`, `border-border`, etc.), wires a theme toggle into the existing `SettingsMenu` dropdown, themes the Sonner Toaster, and tokenizes the scrollbar. Chart components stay dark in both modes per D4 — only their outer page shell themes.

### Stories

- AEV2-401 — Define warm off-white light palette in `:root` block of `app/globals.css`
- AEV2-402 — Add a theme toggle to `components/trading/SettingsMenu.tsx`
- AEV2-403 — Themed Sonner Toaster (consumes `useTheme()`)
- AEV2-404 — Migrate hardcoded color utilities to semantic tokens across `app/`, `components/` (excluding chart files per D4)
- AEV2-405 — Tokenize scrollbar colors in `app/globals.css`
- AEV2-406 — Verify all 5 shadcn primitives with existing `dark:` prefix still render correctly under both themes

### Current State

- `app/globals.css` has `@theme inline { ... }` mapping `--color-*` tokens to `var(--*)` CSS vars, and `:root` + `.dark` blocks both containing identical dark hex values. Scrollbar colors are hardcoded `#000000` track / `rgba(113, 113, 122, 0.9)` thumb (lines 116, 122, 135, 140). Print styles already hardcoded light (`@media print` block lines 184–227) and intentionally bypass theme — leave them untouched.
- `app/layout.tsx` wraps the app in `ThemeProvider` → `SessionProvider` → `MotionConfig`, with `<html lang="en" suppressHydrationWarning>` and `<Toaster theme="dark" ... />` hardcoded.
- `components/theme/theme-provider.tsx` exports `ThemeProvider` (next-themes wrapper with `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `disableTransitionOnChange`). No consumers exist yet — `useTheme()` is unused in the codebase.
- `components/trading/SettingsMenu.tsx` is a gear-icon dropdown with Export Trades (JSON), Export Trades (CSV), Clear All Data. It is the closest thing to a "settings page" in the app — the theme toggle goes here per D2.
- 5 shadcn primitives already use `dark:` prefix correctly: `components/ui/{button,input,textarea,select,dropdown-menu}.tsx`. These should "just work" once `:root` has light values, but verify under both themes during smoke.
- 4 chart files hardcode dark hex strings passed to lightweight-charts and shadcn surfaces: `components/trading/{BacktestChart,ResearchChart,CandlestickChart,ChartDrawings}.tsx`. Per D4 these stay dark in both modes — DO NOT modify any color in these files.
- `npm test` baseline: 714 tests across 98 files — all green.

### Scope

- **In scope:**
  - Light palette hex values in `:root` (warm off-white per D1)
  - Theme toggle inside `components/trading/SettingsMenu.tsx`
  - Themed Toaster reading from `useTheme()` (Sprint 2 deferred this as D6)
  - Tokenize scrollbar colors using new CSS vars
  - Migrate hardcoded color utilities to semantic tokens across all files in `app/`, `components/` EXCEPT the 4 chart files in D4
  - Smoke-check the 5 shadcn primitives that use `dark:` prefix

- **Out of scope:**
  - Chart component color migration (4 files in D4 — entire file stays hardcoded dark in both modes)
  - Trading-semantic colors (profit-green / loss-red / bull / bear / long / short markers) — these stay hardcoded everywhere
  - Print styles in `globals.css` `@media print` block — already light, intentionally bypasses theme
  - `prefers-color-scheme` auto-detection — `enableSystem={false}` stays (Sprint 2 D3)
  - New `/settings` page — toggle lives in the existing `SettingsMenu` dropdown
  - Backtest/Research page layout changes beyond color substitution
  - Adding new semantic tokens beyond what `:root` and `.dark` already define
  - Database / API changes (this sprint is frontend-only)

### Decisions Locked For Sprint 3

These remove ambiguity before Codex starts. If any is wrong, amend before execution — do NOT let Codex discover them mid-sprint.

- **D1. Light palette is warm off-white.** Exact hex values listed under "Light Palette Values" below. Reasoning: User selected from a 3-way prompt; warm off-white (`#FAFAF9` bg, `#1C1917` fg, slightly darker emerald `#059669` for primary) reads better than pure white for long sessions.
- **D2. Theme toggle lives in `SettingsMenu.tsx` dropdown, not a new page or the header.** Reasoning: User chose "Settings page only" from the 3-way prompt; the dropdown IS the de-facto settings UI today, building a new `/settings` route is out of scope.
- **D3. Migration target is `:root` semantic tokens, not `dark:` qualifiers everywhere.** Reasoning: shadcn pattern. Components reference `bg-background`, `text-foreground`, `border-border`, etc., which automatically resolve via `:root` (light) or `.dark` (dark). Adding `dark:` prefix to 800+ utilities would be more code and harder to maintain than swapping to semantic tokens once.
- **D4. The 4 chart files stay hardcoded dark in both modes.** Files: `components/trading/BacktestChart.tsx`, `components/trading/ResearchChart.tsx`, `components/trading/CandlestickChart.tsx`, `components/trading/ChartDrawings.tsx`. Reasoning: User selected "Keep charts dark in both modes" — trader convention, lightweight-charts doesn't reactively swap palettes, and the dark-on-light boundary is intentional (Bloomberg style). Do not touch ANY hex value, `bg-[#...]`, `border-white/...`, or `text-zinc-*` inside these files — **with one exception**: `ResearchChart.tsx` line ~282's outermost JSX element is `<div className="flex h-full flex-col">` with NO background of its own. BacktestChart has its own `bg-[#121214]` wrapper (line 853) and is self-contained, but ResearchChart inherits its background from the parent. To keep ResearchChart visually dark in light mode, ADD `bg-[#121214] border border-white/10` to that outer div (one-line change inside an otherwise untouched file). Do not change anything else in `ResearchChart.tsx`.
- **D5. Trading-domain colors stay hardcoded everywhere.** Specifically: green for positive P/L (`text-emerald-*`, `text-green-*`), red for negative P/L (`text-rose-*`, `text-red-*` when used for losses), bullish/bearish candle markers, long/short indicators. Reasoning: These are domain semantics, not UI chrome. A profit must look like profit in both themes. Estimate-only: roughly 129 `text-(emerald|green|rose|red)-*` occurrences across `components/trading/` — the exact count is not a checklist target, just an indicator of effort.
- **D5a. Brand-green accents on non-trading UI controls migrate to `primary` tokens.** When emerald is used as a *brand accent* on UI chrome (active-tab indicator, selected-state badge, checkbox check state, primary CTA save button, nav highlight) — not as P/L signaling — replace with the `primary` family: `text-emerald-500` → `text-primary`, `bg-emerald-500/10` → `bg-primary/10`, `border-emerald-500` → `border-primary`, `shadow-emerald-500/*` → `shadow-primary/*`, `focus:ring-emerald-500` → `focus:ring-ring`, `ring-emerald-500/30` → `ring-primary/30`. The light palette's `--primary` is `#059669` (slightly darker emerald) so contrast on `#FAFAF9` is correct. Reasoning: The emerald IS the brand color; tying it to `--primary` makes the brand adapt cleanly between themes. The distinguishing test: "Does this color signal trading profit/long/bull?" → keep hardcoded (D5). "Is this color a UI accent that happens to be brand-green?" → migrate to `primary` (D5a).
- **D6. Toaster reads `useTheme()` from next-themes.** `theme` prop becomes `{theme === 'dark' ? 'dark' : 'light'}`. Reasoning: Sonner natively supports `theme="light" | "dark" | "system"`. Sprint 2 deferred this; this sprint owns it.
- **D7. Scrollbar uses CSS vars, not hardcoded `#000000`.** Add `--scrollbar-track` and `--scrollbar-thumb` to both `:root` and `.dark` blocks; reference them in the four `*::-webkit-scrollbar-*` rules and the `scrollbar-color` declarations. Reasoning: A pure-black scrollbar on a `#FAFAF9` background looks like a bug.
- **D8. Migration is one Codex pass, not split sub-sprints.** The diff will be huge (~824 utility swaps + ~30 hex container swaps). Reasoning: User selected "Full migration" — splitting introduces merge friction without reducing risk.
- **D9. Sprint 1's leftover `dark:` prefixes in the 5 shadcn primitives stay.** Reasoning: They work correctly under both themes (e.g. `bg-input/30 dark:bg-input/30`); rewriting them is churn with no visible benefit.

### Light Palette Values (write verbatim into `:root` block of `app/globals.css`)

```css
:root {
  --background: #FAFAF9;
  --foreground: #1C1917;
  --card: #F5F5F4;
  --card-foreground: #1C1917;
  --popover: #FFFFFF;
  --popover-foreground: #1C1917;
  --primary: #059669;
  --primary-foreground: #FFFFFF;
  --secondary: rgba(28, 25, 23, 0.04);
  --secondary-foreground: #1C1917;
  --muted: #EDEDEC;
  --muted-foreground: #57534E;
  --accent: rgba(28, 25, 23, 0.04);
  --accent-foreground: #1C1917;
  --destructive: #DC2626;
  --destructive-foreground: #FFFFFF;
  --border: rgba(28, 25, 23, 0.08);
  --input: rgba(28, 25, 23, 0.12);
  --ring: #059669;
  --chart-1: #10b981;
  --chart-2: #f43f5e;
  --chart-3: #3b82f6;
  --chart-4: #f59e0b;
  --chart-5: #8b5cf6;
  --sidebar-background: #F5F5F4;
  --sidebar-foreground: #1C1917;
  --sidebar-primary: #059669;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: rgba(28, 25, 23, 0.04);
  --sidebar-accent-foreground: #1C1917;
  --sidebar-border: rgba(28, 25, 23, 0.08);
  --sidebar-ring: #059669;
  --scrollbar-track: #EDEDEC;
  --scrollbar-thumb: rgba(28, 25, 23, 0.3);
  --scrollbar-thumb-hover: rgba(28, 25, 23, 0.45);
}
```

Then ADD matching scrollbar vars to the existing `.dark` block (do not change other values there):

```css
  --scrollbar-track: #000000;
  --scrollbar-thumb: rgba(113, 113, 122, 0.9);
  --scrollbar-thumb-hover: rgba(161, 161, 170, 0.95);
```

### Migration Mapping (the table Codex uses for the sweep)

**Treat this as the canonical replacement table.** When a file uses one of the LEFT values for UI chrome (not domain semantics — see D5), replace with the RIGHT value:

| Hardcoded | Replace with |
|---|---|
| `bg-[#0A0A0B]` | `bg-background` |
| `bg-[#121214]` | `bg-card` |
| `bg-[#111319]` | `bg-popover` |
| `bg-[#0d1017]` | `bg-popover` |
| `bg-[#0f0f11]`, `bg-[#0f0f12]` | `bg-card` |
| `bg-[#18181b]` | `bg-card` (if used inside a `DropdownMenuContent` / `PopoverContent` / `DialogContent`, use `bg-popover` instead) |
| `bg-white/5` | `bg-accent` |
| `bg-white/10` | `bg-accent` (`/20` on hover → `bg-accent/80`) |
| `bg-zinc-500`, `bg-zinc-600` | `bg-muted` |
| `bg-zinc-700`, `bg-zinc-800`, `bg-zinc-900` | `bg-card` |
| `border-white/5` | `border-border` |
| `border-white/10` | `border-border` |
| `border-white/15` | `border-border` |
| `border-white/20` | `border-border` |
| `text-white` | `text-foreground` |
| `text-zinc-100` | `text-foreground` |
| `text-zinc-200` | `text-foreground` |
| `text-zinc-300` | `text-muted-foreground` |
| `text-zinc-400` | `text-muted-foreground` |
| `text-zinc-500` | `text-muted-foreground` |
| `text-zinc-600`, `text-zinc-700`, `text-zinc-800`, `text-zinc-900` | `text-muted-foreground` (these are already dark; check after migration that they read on `--background` in light mode — should be fine since `--muted-foreground` is `#57534E`) |
| `placeholder:text-zinc-*` (any shade) | `placeholder:text-muted-foreground` |
| `hover:bg-white/5` | `hover:bg-accent` |
| `hover:bg-white/10` | `hover:bg-accent` |
| `hover:text-white` | `hover:text-foreground` |
| `bg-black/60` (modal backdrop) | `bg-background/80` |
| `shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.1)]` | `shadow-[inset_0_-1px_0_0_var(--border)]` (or replace with `border-b border-border` if simpler) |
| `selection:bg-emerald-500/30` | leave as-is (selection accent is fine across themes) |

**Brand-green accent migration (per D5a) — these are UI chrome, not trading-domain:**

| Hardcoded | Replace with |
|---|---|
| `text-emerald-500` (on active tabs, badges, checkbox checks, nav highlights, CTA save buttons) | `text-primary` |
| `bg-emerald-500/10`, `bg-emerald-500/20` (selected-state backgrounds) | `bg-primary/10`, `bg-primary/20` |
| `border-emerald-500` (selected-state borders) | `border-primary` |
| `shadow-emerald-500/*` (on primary CTAs) | `shadow-primary/*` |
| `focus:ring-emerald-500`, `focus-visible:ring-emerald-500` | `focus:ring-ring`, `focus-visible:ring-ring` |
| `ring-emerald-500/20`, `ring-emerald-500/30`, `ring-emerald-500/40` (non-focus rings) | `ring-primary/20`, `ring-primary/30`, `ring-primary/40` |
| `text-emerald-500` USED FOR P/L "gain" cells, trade direction "long", bullish markers | LEAVE HARDCODED (D5) |

**For `text-emerald-*` / `text-green-*` / `text-rose-*` / `text-red-*`:**
- If the context is **profit/loss display, P/L cells, candle markers, long/short labels, trading-domain status** → LEAVE HARDCODED (per D5).
- If the context is **UI button (e.g. "Clear Data" destructive action) or accent on a non-trading control** → replace with `text-destructive` / `bg-destructive` / `text-primary` / `bg-primary` as appropriate.
- Codex must make this call per occurrence. When ambiguous, leave hardcoded and add a `// theme: domain color — leave hardcoded` comment so it shows up in review.

**For `bg-emerald-500` / `bg-rose-500` / `bg-emerald-600` / `bg-rose-600` (button backgrounds):**
- Primary action buttons → `bg-primary` (`hover:bg-primary/90`)
- Destructive action buttons (e.g. "Clear Data" in SettingsMenu line 133) → `bg-destructive` (`hover:bg-destructive/90`)
- P/L badges, trade-status pills → LEAVE HARDCODED.

### Sweep Order (Codex follows this exact order — easier surfaces first to build the habit, then long tail)

1. `app/layout.tsx` (small)
2. `app/page.tsx` (large — main dashboard shell)
3. `app/api/**` — **DO NOT TOUCH** (server routes have no UI)
4. `components/trading/Sidebar.tsx`
5. `components/trading/SettingsMenu.tsx` (also gets toggle in Story 402)
6. `components/trading/BacktestSimPanel.tsx`
7. `components/trading/BacktestManagerView.tsx`
8. `components/trading/BacktestChartGrid.tsx` — this is the GRID container, NOT the chart itself; the chart panels remain dark per D4 but the grid background themes. Specifically, the empty-state placeholder around line 528 (`border-white/10 bg-[#121214] text-zinc-500`) migrates to `border-border bg-card text-muted-foreground`.
9. Remaining files in `components/trading/` EXCEPT the 4 chart files in D4
10. `components/trading/research-report-sections/**`
11. `components/ui/**` — most are fine. Open each of these and check ONLY their top-level default styles (the `cn(...)` base classes before any variant maps): `command.tsx`, `dialog.tsx`, `label.tsx`, `popover.tsx`, `sheet.tsx`, `TabErrorBoundary.tsx`, `linkified-text.tsx`. If a base class uses a hardcoded `bg-white/*`, `border-white/*`, or `text-zinc-*` value, migrate per the table. Do NOT touch `button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `dropdown-menu.tsx` (per D9 — they use `dark:` correctly).
12. `components/theme/**` — only one file, no chrome to migrate
13. Anything in `components/` not yet covered

After each numbered step, Codex runs `npx tsc --noEmit` to confirm no breakage from a stray typo before moving on.

### Theme Toggle (Story 402) — implementation detail

Modify `components/trading/SettingsMenu.tsx`:
- Import `useTheme` from `next-themes` and `Sun`, `Moon` from `lucide-react`.
- Inside the component (before the existing JSX return), add:
  ```tsx
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';
  ```
- Inside the `DropdownMenuContent`, ABOVE the existing "Export Trades (JSON)" `DropdownMenuItem`, add:
  ```tsx
  <DropdownMenuItem
    onClick={(e) => { e.preventDefault(); setTheme(isDark ? 'light' : 'dark'); }}
    className="cursor-pointer"
  >
    {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
    {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
  </DropdownMenuItem>
  <DropdownMenuSeparator className="bg-border" />
  ```
- `e.preventDefault()` keeps the dropdown open so the user sees the icon swap before the menu closes.
- The label phrasing ("Switch to …") names the *target* state, not the current state, so the click action is unambiguous.

### Themed Toaster (Story 403) — implementation detail

Convert `app/layout.tsx:22` Toaster line. Live code:
```tsx
<Toaster theme="dark" richColors position="bottom-right" />
```
The Toaster is in a server component (`app/layout.tsx`). `useTheme()` is a client hook, so it must be extracted into a client wrapper. Create `components/theme/themed-toaster.tsx`:
```tsx
'use client';
import { Toaster } from 'sonner';
import { useTheme } from 'next-themes';
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme === 'light' ? 'light' : 'dark'} richColors position="bottom-right" />;
}
```
Then in `app/layout.tsx`: remove the `import { Toaster } from 'sonner';` line, add `import { ThemedToaster } from '@/components/theme/themed-toaster';`, and replace `<Toaster theme="dark" richColors position="bottom-right" />` with `<ThemedToaster />`. Preserve `richColors` and `position="bottom-right"` exactly — these are the live props.

### Scrollbar Tokenization (Story 405) — globals.css edits

Replace ALL hardcoded scrollbar color values with CSS vars. The current hardcoded values appear in two blocks — the global `html` + `*` rules in `@layer base` (approximate lines 116, 122, 135, 139–140, 145) and the `.scrollbar-thin` utility class (approximate lines 153, 160, 163–164, 168). Match by selector pattern rather than by line number.

For the `html` block (line ~113) and `*` block (line ~119), change:
```css
scrollbar-color: rgba(113, 113, 122, 0.9) #000000;
```
to:
```css
scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
```

For the `*::-webkit-scrollbar-track` selector, replace `background: #000000;` with `background: var(--scrollbar-track);`.

For `*::-webkit-scrollbar-thumb`, replace `background: rgba(113, 113, 122, 0.9);` with `background: var(--scrollbar-thumb);` and `border: 2px solid #000000;` with `border: 2px solid var(--scrollbar-track);`.

For `*::-webkit-scrollbar-thumb:hover`, replace with `background: var(--scrollbar-thumb-hover);`.

Repeat the same pattern for the `.scrollbar-thin` utility class block (lines ~151–169).

Leave `.scrollbar-hidden` alone (it doesn't use color vars).

### Planned File Actions

**New files:**
- `components/theme/themed-toaster.tsx` — client wrapper around Sonner Toaster that reads `useTheme()` (Story 403)

**Modified files:**
- `app/globals.css` — replace `:root` block with warm off-white palette; add scrollbar CSS vars to both `:root` and `.dark`; swap four scrollbar hardcoded values to use vars (Stories 401, 405)
- `app/layout.tsx` — replace `<Toaster theme="dark" ... />` with `<ThemedToaster />` (Story 403)
- `components/trading/SettingsMenu.tsx` — add theme toggle item to dropdown; also migrate its hardcoded chrome colors to semantic tokens (Stories 402, 404)
- `app/page.tsx`, `components/trading/Sidebar.tsx`, `components/trading/BacktestSimPanel.tsx`, `components/trading/BacktestManagerView.tsx`, `components/trading/BacktestChartGrid.tsx`, plus every other `components/**/*.tsx` file that contains a hardcoded color matching the Migration Mapping table — semantic-token sweep (Story 404)

**Files Codex must NOT modify (per D4 and D5):**
- `components/trading/BacktestChart.tsx`
- `components/trading/ResearchChart.tsx`
- `components/trading/CandlestickChart.tsx`
- `components/trading/ChartDrawings.tsx`
- The `@media print` block in `app/globals.css` (lines 184–227)
- Any color expressing trading domain semantics (P/L green/red, bull/bear, long/short markers) — even outside the 4 chart files

### Acceptance Criteria

- [ ] `app/globals.css` `:root` block contains the warm off-white palette exactly as specified.
- [ ] `app/globals.css` `.dark` block is unchanged except for the three new scrollbar vars appended.
- [ ] Scrollbar in light mode is light gray-on-warm-gray (not black).
- [ ] Theme toggle appears as the first item in the `SettingsMenu` dropdown with a Sun (in dark mode) or Moon (in light mode) icon and a label that flips.
- [ ] Clicking the toggle flips the theme without closing the dropdown (`e.preventDefault()` confirmed).
- [ ] Toaster background follows the theme (white-ish on light, dark on dark) — visible by triggering any `toast()` call after toggling.
- [ ] Charts (Backtest, Research, Candlestick, ChartDrawings) stay dark in both modes; surrounding card containers theme.
- [ ] A grep for `bg-\[#` in `app/` and `components/` returns ONLY occurrences inside the 4 chart files in D4 (plus print-style hex values).
- [ ] A grep for `bg-zinc-[5-9]\|bg-white/[0-9]\|border-white/[0-9]\|text-zinc-[3-9]` in `app/` and `components/` returns ONLY: (a) occurrences inside the 4 chart files in D4, (b) the 5 shadcn primitives that use `dark:` prefix correctly per D9, and (c) lines annotated with `// theme: domain color — leave hardcoded`. To verify, run `grep -rn --include='*.tsx' -E 'bg-zinc-[5-9]|bg-white/[0-9]|border-white/[0-9]|text-zinc-[3-9]' app components | grep -v 'BacktestChart\.tsx\|ResearchChart\.tsx\|CandlestickChart\.tsx\|ChartDrawings\.tsx\|components/ui/button\.tsx\|components/ui/input\.tsx\|components/ui/textarea\.tsx\|components/ui/select\.tsx\|components/ui/dropdown-menu\.tsx\|theme: domain color'` and confirm the result is empty (or only contains trading-domain occurrences carrying the marker comment).
- [ ] All trading P/L green/red colors visibly indicate profit/loss in BOTH light and dark modes (manual smoke).
- [ ] No new TypeScript errors; no new ESLint warnings.
- [ ] All 714 existing tests still pass (no test changes expected).

### Validation

Run before marking the sprint COMPLETE:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run workflow:audit` (HANDOFF.md is a workflow asset)

Manual smoke (user-run after the Codex pass):
1. In DevTools Application tab, clear `localStorage` key `theme` and reload — confirm app loads in dark mode (the `defaultTheme="dark"` from Sprint 2's D3).
2. Toggle theme via SettingsMenu dropdown. Confirm:
   - Background flips from dark to warm off-white.
   - Sidebar, top bar, modals, dialogs, dropdowns all flip correctly.
   - Charts stay dark in both modes (including ResearchChart's outer panel after D4's one-line exception is applied).
   - Toaster background flips (trigger any toast — e.g. trigger any save action).
   - Scrollbar flips (dark thumb on dark mode, gray-on-warm-gray on light).
   - P/L colors stay green/red in both modes.
   - Brand-green UI accents (active tabs, badges, primary CTAs) shift slightly darker in light mode (because `--primary` is `#059669` light vs `#10b981` dark) — should still look like the same brand color, not "off".
   - No visible "leaked" dark backgrounds inside light-mode panels (other than charts).
   - No visible "leaked" light text on dark backgrounds.
3. Refresh the page in each mode. Confirm no flash-of-wrong-theme.
4. Set `localStorage.theme = 'light'` manually in DevTools, reload — confirm light loads cleanly with no flash.
5. Open every major surface: Sidebar, Backtest Manager, Backtest Sim Panel, Research (chart + sub-tabs), Settings dropdown, every modal. Each should look intentional in both modes.

### Implementation Style

Write the simplest correct code that matches the existing conventions in each file. Three similar lines beat a premature abstraction. Do not introduce new helper functions, wrappers, or types beyond what's specified above. Do not add defensive runtime checks at internal boundaries. Do not add feature flags or "future-proof" scaffolding. Do not refactor surrounding code that isn't part of the migration. If a file's only change is a color utility swap, the diff should be exactly that — no other edits.

When the per-occurrence judgment call between "UI chrome (migrate)" and "trading-domain color (leave hardcoded)" is ambiguous, default to **leaving hardcoded** and adding a single-line comment `// theme: domain color — leave hardcoded` directly above the line. Review will catch any that should have been migrated.

---

## Recently Completed

### Sprint 2 — Light Mode Infrastructure

Status: completed 2026-05-22 (commit `91dfeb0`).

Outcome:
- Installed `next-themes@^0.4.6` and added `components/theme/theme-provider.tsx` with `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `disableTransitionOnChange`.
- Rewrote `app/layout.tsx`: removed hardcoded `className="dark"`, added `suppressHydrationWarning` on `<html>`, wrapped providers in `ThemeProvider` (outermost) → `SessionProvider` → `MotionConfig`; `Toaster` stays hardcoded `theme="dark"` per D6.
- Refactored `app/globals.css` `@theme inline` to reference per-token CSS vars; added matching `:root` and `.dark` blocks with identical dark-palette values (Sprint 3 will diverge `:root`).
- Sprint 1 follow-up: dropped local `toEpochMs` in `components/trading/BacktestChart.tsx` and pulled it from `@/lib/chart-time`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 714 tests) — all green.
- Static checks: no local `function toEpochMs`, `className="dark"` count = 0, `next-themes` appears once in `package.json`.
- Manual A/B browser smoke + DevTools `localStorage` light/dark swap remain user-run before merge.

### Tier 1 Mechanical Cleanup Pass

Status: completed 2026-05-22 (commit `61858f1`).

Outcome:
- Added `requireUser()` gates to `/api/agents/macro-summary/latest` and `/api/agents/market-pulse/latest`; both now 401 for unauth callers.
- Removed unused `@tailwindcss/typography` dep and broken `next clean` script; refreshed `package-lock.json`.
- Refreshed `docs/ARCHITECTURE.md`, `AGENTS.md`, and `docs/ae-buildout.md` for current helper layout + Ask Edgar scopes; cleared the five completed findings from `docs/repo-cleanup.md`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (714 tests, +2 new auth-rejection cases), `npm run workflow:audit` — all green.
- `npm run clean` correctly reports `Missing script`; zero `@tailwindcss/typography` refs across `package.json` + `package-lock.json`.

### Persist Chart Drawings + Indicators to DB

Status: completed 2026-05-22 (commit `73dcc32`).

Outcome:
- New `chart_drawings` table (PK `(user_id, ticker, bucket)`, `bucket ∈ {intraday, higher}`) with `app/api/chart-drawings` GET/PUT under `requireUser()`.
- `BacktestChartGrid` runs two bucket-keyed controllers; drawings + per-slot indicators persist per `(user, ticker, bucket)` and `BacktestChart.tsx:424` no longer gates draw on `frame.intraday` — daily/weekly/monthly slots can draw too.
- Saved reviews remain read-only and render from `chartState`; `chartStateSchema` accepts both legacy flat and new bucketed shapes (back-compat covered by `normalizeChartState`).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all green (98 files, 712 tests).
- `npm run db:migrate` applied `drizzle/0042_happy_felicia_hardy.sql`.
- Manual smoke (Step 8 paths) still pending user-run dev-server validation.

### Sprint 1 — Pre-Light-Mode Refactors

Status: completed 2026-05-22.

Outcome:
- Added shared `toTime()` in `lib/chart-time.ts` and extracted session-shading rect state/recalculation into `hooks/use-session-shading.ts`.
- Migrated `ResearchChart`, `CandlestickChart`, and `BacktestChart` to the hook while keeping their existing range-change, resize, and initial-layout scheduling triggers.
- Split `ResearchReportSections.tsx` into a thin 41-line dispatcher plus six tab/shared modules under `components/trading/research-report-sections/`; the default export path and caller set stayed unchanged.

Validation:
- Interim `npx tsc --noEmit` passed after Step 2 before any chart call site was migrated.
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all green (98 files, 714 tests).
- Static acceptance checks passed: no local `function toTime` / `function toUTCSeconds` in `components/trading/`, one `useSessionShading` hook call per chart file, exactly six research section files, and unchanged `ResearchReportSections` callers.
- Manual browser smoke for chart shading and five Research sub-tabs remains post-merge/user-run; no dev-server smoke was run in this session.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Open Follow-Ups

- **Offerings extractors fresh-ticker smoke check**: the 2026-05-19 offerings broadening shipped, but the WNW manual smoke was inconclusive because the Research snapshot was cached. Next time Research is opened on a fresh ADS / FPI ticker whose `askedgar_cache` row has expired or does not exist, confirm Shares / Price / Amount populate for at least one priced row in Past Offerings. If every value is `--`, capture the filing URL from the row's SEC link and open a follow-up spec for the missing phrasing variant.
