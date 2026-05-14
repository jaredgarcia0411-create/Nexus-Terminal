# FUTURE-PLANS.md

Parked ideas and longer-horizon plans. Each entry should note **why it's parked** and what would unblock it.

---

## Embed AskEdgar via iframe (parked 2026-05-01)

### The idea
Coworker suggested embedding the AskEdgar website inside Nexus Terminal's research tab via an `<iframe>`. The premise was:
- Share **one** AskEdgar subscription across the team
- Reduce our own API/build work since users would interact with AE directly
- Potentially replace the entire research tab

### Why it's parked
**AskEdgar's Terms of Service explicitly forbid the shared-subscription premise.**

Direct quotes from https://www.askedgar.io/legal/terms:
- > "Your account may only be used by one person. A single account shared by multiple people is not permitted."
- > "Each person must set up a new account for themselves."
- "Sharing logins" is listed as a suspension trigger.
- No bulk-download / scraping / programmatic access permitted.
- No redistribution without a separate written business license.
- No team/multi-seat plan in the standard ToS.

Going ahead with the original idea would put the account at risk of suspension. Not worth it.

### Technical feasibility (in case the legal side changes)
Checked 2026-05-01:
- `app.askedgar.io` returns no `X-Frame-Options` header and no `Content-Security-Policy` header.
- No CSP `<meta>` tag in the HTML.
- **Headers say embedding is allowed.** This could change at any time without notice.

Untested caveats — would need to verify with a real embed:
- Third-party cookie blocking (Chrome/Safari) often breaks login persistence inside cross-origin iframes.
- Next.js middleware can apply CSP per-route, so deep authenticated routes might behave differently than the login page.
- Cross-origin policy means we can't read iframe content, sync state, pre-fill searches, or extract data — it would be a visual passthrough only.

### Options to revisit later

1. **Each user buys their own AE subscription**, Nexus embeds AE purely as a UX convenience.
   - ToS-compliant.
   - Cuts our dev work on the AE replacement.
   - Costs each coworker a subscription.
   - Doesn't reduce our API calls if the current AE integration is server-side — it shifts load to AE's infra.

2. **Contact AskEdgar about a business / team license.**
   - Their ToS specifically mentions a "separate written business license agreement" exists.
   - A negotiated team rate for a handful of seats is plausible.
   - Lowest-risk path to making the original idea legitimate.
   - **Cheapest first step:** send an email before doing any technical work.

3. **Drop the iframe idea entirely, keep building the AE replacement in-house.**
   - No legal risk, no per-seat cost.
   - Keeps full dev burden on us.

### Triggers to revisit
- AE adds a public team/multi-seat plan.
- We get a response from AE on a business license.
- Our in-house AE replacement stalls and we need a faster path.

### What to check before acting
- Re-test `app.askedgar.io` headers — they may have added `X-Frame-Options` or CSP `frame-ancestors` since this was written.
- Re-read the [ToS](https://www.askedgar.io/legal/terms) — clauses change.
- Confirm our existing `lib/askedgar.ts` integration is still ToS-compliant (cached helpers, not bulk download).

---

## Semantic-token migration pass (parked 2026-05-04)

### The idea
Replace hardcoded color literals in `.tsx` files (`bg-[#121214]`, `text-white`, `border-white/10`, etc.) with the semantic tokens already defined in `app/globals.css` (`bg-card`, `text-foreground`, `border-border`, etc.). Same visual output, but every color routes through one variable in `globals.css` instead of being splattered across ~50 files.

### Why it's worth doing on its own
- Fixes the recurring UI-inconsistency pain point — right now "the card background" is `#121214` in some files, `bg-zinc-900` in others, `bg-white/[0.02]` in a few more. Tokens give you one source of truth.
- shadcn/ui (already in use, see `components.json`) is built around these tokens — the trading-specific components just drifted into hex literals over time.
- Makes a future light-mode toggle a weekend job instead of a 1–2 day project (see "Why it's parked" below).

### Why it's parked
Bigger goal it unblocks (light/dark mode toggle) isn't a priority right now. The migration itself is mechanical but touches ~50 files, so we'd want to batch it as one focused pass rather than dribble it in.

### The mapping
| Hardcoded | Semantic token |
|---|---|
| `bg-[#0A0A0B]` | `bg-background` |
| `bg-[#121214]` | `bg-card` (or `bg-popover` for menus/dropdowns) |
| `bg-[#18181b]` | `bg-muted` |
| `text-white` | `text-foreground` |
| `text-zinc-400` / `text-zinc-500` | `text-muted-foreground` |
| `border-white/10` / `border-white/5` | `border-border` |
| `bg-white/5` | `bg-accent` (or `bg-input` for input fields) |
| `text-rose-500` (destructive actions) | `text-destructive` |

**Stays literal on purpose:** P&L greens/reds (`text-emerald-400`, `text-rose-400`) and chart-specific tints. Those are data viz, not UI chrome.

### Scope at time of writing (2026-05-04)
- `bg-[#…]` / `bg-zinc-*` / `bg-white/N` literals: **49 files**
- `text-white` / `text-zinc-*` literals: **49 files**
- `border-white/N` / `border-zinc-*` literals: **46 files**
- Out of **60** total `.tsx` files in `components/` + `app/`

### Execution plan
1. **Pilot a single file** (e.g. `components/trading/SettingsMenu.tsx`). Apply the mapping, run `npm run lint && npx tsc --noEmit`, eyeball the diff vs `main` — should be visually identical.
2. **Walk the file list.** Group by family (`Backtest*.tsx`, `Performance*.tsx`, `Research*.tsx`) so the context-switching is minimal.
3. **Skip charts in this pass.** `BacktestChart.tsx`, `CandlestickChart.tsx`, `ResearchChart.tsx`, `PerformanceCharts.tsx` pass colors as JS strings to chart libraries (lightweight-charts, recharts) — those don't accept Tailwind classes. They'd need a `getComputedStyle(...).getPropertyValue('--color-card')` pattern, which is a separate, smaller pass.
4. **Validate.** `npm run lint && npx tsc --noEmit && npm test`, then click through every tab/dialog/sheet — the goal is zero pixel diff.

### Best way to run it
Mechanical + explicit rules + easy to verify with `git diff` → ideal Codex spec. Hand Codex a `HANDOFF.md` containing the mapping table, the file list, and the "do not touch chart-init color strings" rule. Suggest piloting one file manually first to confirm the mapping looks right before fanning out.

### Triggers to revisit
- Want to add a light-mode toggle (this migration is the prerequisite).
- UI inconsistencies become painful enough to fix on their own merits.
- A larger UI redesign — would want tokens in place before changing the palette.

### What to check before acting
- Re-grep counts — files may have grown/shrunk since this was written.
- Confirm `app/globals.css` token names still match the table above.
- Decide whether to also collapse the chart-color JS strings in the same pass or defer.
