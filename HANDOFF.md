# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-11
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-16, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Sheets Sprints 1-7 + Massive Wave 1-2, backtest user-id fixes, Filing headline parser, Calendar Year Overview, Workflow Maintenance, Nav Reorg, Sheets Today-filter + report-by-ticker/date, EODHD News API swap) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---


## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

> Historical completed sections (Rich Text + Autosave for Reviews/Notes, Playbook Auto-Save + Font-Size, Playbook Rich Text, News Section Redesign) were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

---

## Recently Completed

### Filing Headline Parser (EX-99.1 → real PR headlines)

Status: completed 2026-06-12 (commit b6de3e1).

Outcome:
- 6-K/8-K filing rows now show the real press-release headline pulled from the `EX-99.1` exhibit (both Research **News** and **Filings** tabs), falling back to the title-cased form label when no exhibit / no parse.
- Bounded inline on first research load (cap 8 most-recent material filings); cached per-accession forever in a new nullable `sec_filings_raw.pr_headline` column (NULL=unchecked, ''=checked/no-PR, text=headline). Only the `research-filings` profile enriches.
- Extraction is heuristic (first non-boilerplate / post-dateline line); other forms (S-1, 424B, Form 4) untouched.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (836 passed). Migration `drizzle/0050_last_kree.sql` generated.

### Unified News Feed (EODHD articles + material SEC filings)

Status: completed 2026-06-12 (commit 5881f3b).

Outcome:
- Research **News** tab now merges EODHD press articles with material SEC filings (buckets `news`/`registrations`/`prospectus` → 8-K/6-K, S-1/S-3/F-*, 424B), date-sorted newest-first; Form 4/13G/10-K/proxies excluded. Filings tab and the agent are untouched.
- Filing rows render as `<a target="_blank">` to the SEC doc with a form-type badge; article rows keep the in-app reader. EODHD `limit` bumped 20→50.
- Known gaps (accepted): filing rows show generic form labels not PR headlines (parser deferred — see Open Follow-Ups); pure-promo PRs with no filing still won't appear.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (831 passed).

### Mobile Optimization — 7 Responsive Fixes

Status: completed 2026-06-11.

Outcome:
- Responsive fixes across bottom nav, macro/report headers, Performance Stats, Career P/L, Playbook header, Research restack, and global page padding — desktop (≥768px) unchanged.
- Research mobile fix: dropped the fixed-height inner-scroll anchor on mobile (`min-h-[60vh] md:h-[calc(100vh-120px)]`) so the stacked header+chart+report flow and the page scrolls (was clipping the Overview chart).
- Moved Research "Add to Sheets" next to the symbol search box on mobile (`md:hidden`); desktop keeps the overlaid button.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (830 passed).
- Founder confirmed on mobile: Overview chart fully visible, Add-to-Sheets beside search.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
