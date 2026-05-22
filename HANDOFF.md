# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-22
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

---

## Sprint 2 — Light Mode Infrastructure

> Generated: 2026-05-22 | Agent: Claude (Plan)
> Status: CODE COMPLETE — automated validation passed; manual A/B browser smoke pending
> Executes on worktree (see Step 0). Worktree branch: `sprint-2-light-infra`.

### Objective

Stand up the plumbing that makes a future light/dark theme switch possible — without changing any visuals yet. After this sprint, the app must look pixel-identical to `main` whether the user is on `dark` or `light`, because the light token values are intentional placeholders identical to the dark values. Sprint 3 will diverge the light tokens and add the toggle UI. Also: clean up the `toEpochMs` duplicate in `BacktestChart.tsx` that Sprint 1 left behind.

### Stories

- LT-001 — Cleanup: drop the duplicate `toEpochMs` in `BacktestChart.tsx`; import from `lib/chart-time`.
- LT-002 — Install `next-themes` and mount its provider; let it own the `.dark` class on `<html>`.
- LT-003 — Restructure `app/globals.css` so every color token resolves through a per-theme CSS variable (`:root` + `.dark`), with both blocks defining identical values for this sprint.

### Current State

- Tailwind v4 with single-file CSS config (`app/globals.css`); no `tailwind.config.ts`. Theme tokens live inside `@theme inline { ... }` at the top of `globals.css`.
- `app/layout.tsx:14` hard-codes `<html lang="en" className="dark">`. `app/layout.tsx:20` hard-codes `<Toaster theme="dark" ... />`.
- `app/globals.css` declares `@custom-variant dark (&:is(.dark *));` so `dark:` utilities respond to a `.dark` class on any ancestor.
- Five shadcn primitives use `dark:` prefixes (`components/ui/{button,input,textarea,select,dropdown-menu}.tsx`). Their non-dark variants will activate when the `.dark` class is absent.
- `next-themes` is NOT a dependency.
- `BacktestChart.tsx:164-180` declares a local `toEpochMs` identical to the one exported from `lib/chart-time.ts:28`. Used at lines 726, 737, 753. `BacktestChart.tsx:59` imports `toTime` from `@/lib/chart-time` but skipped `toEpochMs`. `CandlestickChart.tsx` consolidates this correctly; `BacktestChart` did not.
- Scrollbar colors in `globals.css` (`#000000` track, `rgba(113,113,122,0.9)` thumb) are hardcoded — not currently tokenized. Print styles (`@media print`) have their own hardcoded light scheme — leave alone.

### Scope

- **In scope:** `next-themes` install, ThemeProvider mount, layout.tsx wiring, globals.css token restructure into `:root` + `.dark` (identical values), BacktestChart `toEpochMs` cleanup.
- **Out of scope:** any visual change, theme toggle UI button, themed Toaster wrapper (Toaster stays hardcoded `theme="dark"` this sprint), `prefers-color-scheme` / system theme detection, real light token values, scrollbar tokenization, sweep of `dark:` prefix usage across components, migration of any chart/canvas-internal colors (chart libraries draw to canvas — not CSS-driven).

### Decisions Locked For Sprint 2

- **D1. Library choice and version range.** Use `next-themes` in the `^0.4` range. **Why:** it handles the SSR no-flash inline script, hydration, and storage; rolling our own is ~30 lines that would still need the inline script to avoid the FOUC. Adds one ~3KB client dep. **If `npm install next-themes` resolves to anything outside `^0.4` (e.g. an unreleased 1.x), stop and flag — do not upgrade the major.**
- **D2. Default theme.** `defaultTheme="dark"`. **Why:** preserves current behavior. Existing users see no change on first paint.
- **D3. System theme detection.** Disabled (`enableSystem={false}`). **Why:** infrastructure-only sprint; user-controlled toggle is Sprint 3. Avoids surprise theme flips for users on macOS light-mode systems.
- **D4. Light token values.** Identical to dark values for Sprint 2. **Why:** the explicit acceptance criterion is "zero visual change in either mode." Sprint 3 picks real light palette.
- **D5. Theme toggle UI component.** Out of scope. **Why:** scope creep — the user explicitly chose "infrastructure only, no visual changes yet." User flips theme during validation by setting `localStorage.theme` in DevTools.
- **D6. Themed Toaster wrapper.** Out of scope. Toaster keeps `theme="dark"` hardcoded. **Why:** Sonner's `theme` prop is independent of next-themes; wiring it requires a client wrapper that has no caller until the toggle ships in Sprint 3.
- **D7. Where to place the new provider component.** `components/theme/theme-provider.tsx` (new directory). **Why:** keeps theme concerns isolated from `components/ui` (shadcn primitives) and `components/trading` (feature components).
- **D8. CSS variable naming.** Use unprefixed names in `:root` / `.dark` (e.g. `--background`), and reference them from `@theme inline` (e.g. `--color-background: var(--background)`). **Why:** matches the canonical shadcn-v4 + Tailwind-v4 pattern; the `--color-*` namespace is what Tailwind utilities consume, while the unprefixed names are what theme classes override.
- **D9. `@theme inline` non-color tokens.** Keep `--radius` and any non-color values inline (not theme-scoped). **Why:** only colors flip between themes; radius/spacing/font do not.
- **D10. `<html className="dark">` removal.** Remove the hardcoded class; let `next-themes` inject it via its inline pre-paint script. **Why:** next-themes is the source of truth once mounted — duplicating it would risk drift if defaults change.
- **D11. `suppressHydrationWarning`.** Add to `<html>` (currently only on `<body>`). **Why:** next-themes mutates the `<html>` class before React hydrates; without the suppression React will log a hydration mismatch on every page load.

### Step 0 — Worktree Setup (User, BEFORE Codex starts)

**Codex: do NOT execute Step 0. It is a manual user step performed before you receive this spec. Start at Step 1.**

User runs from `/home/jared/Nexus-Terminal` (main checkout):

```bash
git worktree add ../Nexus-Terminal-light-infra -b sprint-2-light-infra
cd ../Nexus-Terminal-light-infra
npm install
```

Then opens this worktree in a second editor/terminal and hands Codex this HANDOFF.md from the worktree path. Codex executes all subsequent steps inside `../Nexus-Terminal-light-infra`.

For A/B comparison during validation:
- Terminal 1 (main): `cd /home/jared/Nexus-Terminal && npm run dev` → http://localhost:3000
- Terminal 2 (worktree): `cd ../Nexus-Terminal-light-infra && npm run dev -- --port 3001` → http://localhost:3001

### Planned File Actions

**New files:**
- `components/theme/theme-provider.tsx` — thin client wrapper around `next-themes`' `ThemeProvider` with our locked defaults.

**Modified files:**
- `package.json` + `package-lock.json` — add `next-themes` (latest, `^0.4`).
- `app/globals.css` — refactor `@theme inline` color tokens to reference `var(--<name>)`; add `:root { ... }` and `.dark { ... }` blocks with identical values for every color.
- `app/layout.tsx` — remove `className="dark"` from `<html>`; add `suppressHydrationWarning` to `<html>`; wrap providers in `<ThemeProvider>`.
- `components/trading/BacktestChart.tsx` — delete local `toEpochMs` (lines 164–180); add `toEpochMs` to the existing `@/lib/chart-time` import on line 59.

**Deleted files:** none.

### Step 1 — Cleanup: BacktestChart `toEpochMs` (Sprint 1 follow-up)

File: `components/trading/BacktestChart.tsx`

1a. Edit line 59 from:
```ts
import { formatNyCrosshair, formatNyTime, toTime } from '@/lib/chart-time';
```
to:
```ts
import { formatNyCrosshair, formatNyTime, toEpochMs, toTime } from '@/lib/chart-time';
```

1b. Delete lines 164–180 (the local `function toEpochMs(time: Time | null | undefined): number | null { ... }` block). The three call sites (lines 726, 737, 753) resolve to the imported version automatically — no other edits needed.

1c. Run `npx tsc --noEmit` to confirm. Expected: clean.

### Step 2 — Install `next-themes`

Run from the worktree root:

```bash
npm install next-themes
```

Confirm `package.json` shows `"next-themes": "^0.4.x"` under `dependencies` (whatever current is — do not pin major).

### Step 3 — Create `components/theme/theme-provider.tsx`

Create the directory if it doesn't exist, then create the file with this exact content:

```tsx
'use client';

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
```

**Notes:**
- `attribute="class"` makes next-themes toggle the `dark` class on `<html>`, which matches the `@custom-variant dark (&:is(.dark *))` declaration in `globals.css`.
- `disableTransitionOnChange` prevents CSS transitions from animating during a theme swap (would look glitchy when the toggle ships in Sprint 3).
- Spreading `{...props}` after our defaults lets callers override later (Sprint 3 may want different defaults on a specific subtree); for this sprint nothing overrides.
- `ThemeProviderProps` is a direct named export from `next-themes` ^0.4. If for any reason that import fails to resolve, do NOT fall back to a ComponentProps trick — stop and report, because the version range is wrong.

### Step 4 — Update `app/layout.tsx`

Replace the entire body of the `RootLayout` function. Final file should look like:

```tsx
import type { Metadata } from 'next';
import { MotionConfig } from 'motion/react';
import { SessionProvider } from 'next-auth/react';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexus Terminal',
  description: 'Professional trading journal and performance analytics',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <SessionProvider>
            <MotionConfig reducedMotion="user">
              {children}
            </MotionConfig>
            <Toaster theme="dark" richColors position="bottom-right" />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**What changed:**
- Removed `className="dark"` from `<html>` (D10).
- Added `suppressHydrationWarning` to `<html>` (D11) — kept on `<body>` too since other state may mismatch.
- Added `ThemeProvider` import + wrap.
- `Toaster` keeps `theme="dark"` hardcoded (D6).
- `SessionProvider` and `MotionConfig` are now children of `ThemeProvider` so any descendant can call `useTheme()`.

**Provider order is locked**: `ThemeProvider` > `SessionProvider` > `MotionConfig`, with `Toaster` sibling to `MotionConfig` inside `SessionProvider`. Do not reorder. ThemeProvider must be outermost so any client component (including the future toggle in Sprint 3) can read theme state.

### Step 5 — Restructure `app/globals.css`

Goal: every color token currently in `@theme inline` becomes a reference to a CSS variable defined in BOTH `:root` and `.dark` with identical values. `--radius` stays inline (D9).

**Identify the block by content, not by line number.** Find the existing block that opens with `@theme inline {` (immediately after the `@custom-variant dark (&:is(.dark *));` line and a blank line) and closes with the matching `}` (immediately before a blank line and the `@layer base {` block). Replace that block — and only that block — with the three blocks below. Everything OUTSIDE this block (`@import` lines, `@custom-variant dark`, `@layer base`, scrollbar utilities, print styles) is unchanged. Do not edit any other part of the file.

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius: 0.75rem;
  --color-sidebar-background: var(--sidebar-background);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

:root {
  --background: #0A0A0B;
  --foreground: #E4E4E7;
  --card: #121214;
  --card-foreground: #E4E4E7;
  --popover: #121214;
  --popover-foreground: #E4E4E7;
  --primary: #10b981;
  --primary-foreground: #000000;
  --secondary: rgba(255, 255, 255, 0.05);
  --secondary-foreground: #E4E4E7;
  --muted: #18181b;
  --muted-foreground: #71717a;
  --accent: rgba(255, 255, 255, 0.05);
  --accent-foreground: #E4E4E7;
  --destructive: #f43f5e;
  --destructive-foreground: #ffffff;
  --border: rgba(255, 255, 255, 0.05);
  --input: rgba(255, 255, 255, 0.1);
  --ring: #10b981;
  --chart-1: #10b981;
  --chart-2: #f43f5e;
  --chart-3: #3b82f6;
  --chart-4: #f59e0b;
  --chart-5: #8b5cf6;
  --sidebar-background: #0A0A0B;
  --sidebar-foreground: #E4E4E7;
  --sidebar-primary: #10b981;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: rgba(255, 255, 255, 0.05);
  --sidebar-accent-foreground: #E4E4E7;
  --sidebar-border: rgba(255, 255, 255, 0.05);
  --sidebar-ring: #10b981;
}

.dark {
  --background: #0A0A0B;
  --foreground: #E4E4E7;
  --card: #121214;
  --card-foreground: #E4E4E7;
  --popover: #121214;
  --popover-foreground: #E4E4E7;
  --primary: #10b981;
  --primary-foreground: #000000;
  --secondary: rgba(255, 255, 255, 0.05);
  --secondary-foreground: #E4E4E7;
  --muted: #18181b;
  --muted-foreground: #71717a;
  --accent: rgba(255, 255, 255, 0.05);
  --accent-foreground: #E4E4E7;
  --destructive: #f43f5e;
  --destructive-foreground: #ffffff;
  --border: rgba(255, 255, 255, 0.05);
  --input: rgba(255, 255, 255, 0.1);
  --ring: #10b981;
  --chart-1: #10b981;
  --chart-2: #f43f5e;
  --chart-3: #3b82f6;
  --chart-4: #f59e0b;
  --chart-5: #8b5cf6;
  --sidebar-background: #0A0A0B;
  --sidebar-foreground: #E4E4E7;
  --sidebar-primary: #10b981;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: rgba(255, 255, 255, 0.05);
  --sidebar-accent-foreground: #E4E4E7;
  --sidebar-border: rgba(255, 255, 255, 0.05);
  --sidebar-ring: #10b981;
}
```

**Why `:root` AND `.dark` both contain dark values:** when next-themes sets theme=`light`, the `.dark` class is removed from `<html>` and only `:root` values apply. We want light and dark to look identical this sprint, so both blocks hold the dark palette. Sprint 3 will edit only `:root` (light) and leave `.dark` alone, producing the divergence.

### Acceptance Criteria

- [ ] `git status` in worktree shows the 5 expected modified files plus `components/theme/theme-provider.tsx` as new.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` all pass with 714 tests (no test was added or removed).
- [ ] `grep -n "function toEpochMs" components/trading/BacktestChart.tsx` returns nothing.
- [ ] `grep -n "toEpochMs" components/trading/BacktestChart.tsx` shows only the import line and three call sites.
- [ ] `grep -c "className=\"dark\"" app/layout.tsx` returns `0`.
- [ ] `grep -c "next-themes" package.json` returns `1`.
- [ ] Worktree `npm run dev` boots without console errors or hydration warnings.
- [ ] Worktree at http://localhost:3001 is visually indistinguishable from main at http://localhost:3000 across: Dashboard, Trading tab (chart + research), Backtests, Management. (User-run; report a brief "matches main on N screens" line.)
- [ ] DevTools test on worktree: open console, run `localStorage.removeItem('theme'); location.reload();` (clears any stale value from a prior dry-run). Then run `localStorage.setItem('theme', 'light'); location.reload();`. Confirm app still renders the dark palette (because `:root` values equal `.dark` values). No console errors.
- [ ] Revert test: `localStorage.setItem('theme', 'dark'); location.reload();`. Confirm `<html class="dark">` re-appears in DevTools Elements panel.

### Validation

Run before marking the sprint COMPLETE:

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- Manual A/B browser smoke vs main (acceptance criteria above).

Codex code pass 2026-05-22:
- `npm run lint` — passed.
- `npx tsc --noEmit` — passed after Step 1 and after full implementation.
- `npm test` — passed (98 files, 714 tests).
- Static acceptance checks passed: no local `function toEpochMs`, `toEpochMs` appears only at the import plus three call sites, `className="dark"` count is `0`, `next-themes` appears once in `package.json` at `^0.4.6`.
- Worktree dev server started on `http://localhost:3001` after sandbox escalation. `agent-browser` CLI was not available on PATH, so visual A/B and DevTools localStorage checks remain user-run/pending.
- `/login` returned HTTP 200 from the worktree dev server, and rendered HTML includes the `next-themes` pre-paint script with `defaultTheme="dark"`.

### Notes for Codex

- Do NOT introduce a theme toggle UI button anywhere. D5 explicitly defers it.
- Do NOT create a `themed-toaster.tsx` wrapper. D6 explicitly defers it; the existing hardcoded `theme="dark"` on Toaster is correct for this sprint.
- Do NOT touch the 5 shadcn primitives that use `dark:` prefix utilities. Their behavior is correct as-is — they'll start using the light variants in Sprint 3 once real light tokens land.
- Do NOT tokenize the scrollbar colors in `globals.css`. Out of scope; Sprint 3.
- Do NOT touch `@media print` styles. They're intentionally hardcoded light for PDF export.
- Do NOT migrate any chart library colors (lightweight-charts draws to canvas using JS-passed color strings; CSS variables don't apply). Out of scope; Sprint 3 will plumb chart colors through the theme via JS.
- If `next-themes` install pulls in any peer-dep warning, log it but do not patch peer deps — react/next versions are already correct.
- If TypeScript complains about `ComponentProps<typeof NextThemesProvider>` not being exported, fall back to `React.ComponentProps<typeof NextThemesProvider>`. Both forms are equivalent.

## Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Recently Completed

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
