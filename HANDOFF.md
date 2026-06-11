# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-10
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

---

## Recently Completed

### Rich Text + Autosave for Reviews & Trade Notes

Status: completed 2026-06-11 (commits `f0bfd28` + `47b2e0b`, reviewed + smoke-tested).

Outcome:
- Daily Review, Weekly Review (via shared `TemplateFieldRenderer`), and Trade Details → Notes are now Tiptap rich-text editors; `RichTextEditor` gained an `editable` prop for formatted read-only rendering (View mode / Archive / PDF). No DB changes — HTML stored in the existing string fields.
- localStorage autosave drafts on all three surfaces (`nexus-trade-notes-drafts`, `nexus-daily-review-drafts`, `nexus-weekly-review-drafts`) via shared `lib/drafts.ts`, with amber "Unsaved draft" pill; report drafts re-pin auto P/L fields so stale values never shadow live aggregates, and only surface in Edit mode.
- Review-found bug fixed: `editor.setEditable(editable)` defaults to emitting `'update'`, which fired `onChange` on mount and wrote a phantom draft (pill showed with no edits). Fixed with `setEditable(editable, false)` in `rich-text-editor.tsx`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all pass.
- Manual smoke by Jared: rich text + autosave on all three surfaces working; spurious-pill bug gone.

### Playbook Auto-Save Drafts + Font-Size Control

Status: completed 2026-06-11 (commit `b50a7a7`, reviewed against spec).

Outcome:
- Unsaved Playbook edits auto-mirror to `localStorage` (`nexus-playbook-drafts`), surviving refresh / tab-close / sub-tab switch; an amber "Unsaved draft" pill shows while a draft is pending and clears on Save/Delete. Orphan drafts pruned on load. Self-contained in `PlaybookTab.tsx`.
- Tiptap bubble toolbar gains a Default/Small/Normal/Large/Huge font-size dropdown (`@tiptap/extension-text-style`, stored as inline `font-size` — no DB migration).
- Justified drift: used the project's shadcn `Select` (controlled `open` state) + a BubbleMenu `shouldShow` carve-out instead of a native `<select>`, so opening the dropdown doesn't blur the editor and collapse the menu. Also nudged the description input to `text-foreground`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (829 tests), `npm run build` — all pass.
- Manual smoke by Jared: drafts + size control good after in-session adjustments.

### Playbook Rich Text Editor (Tiptap trial)

Status: completed 2026-06-11 (commit `6423d3a`, reviewed against spec).

Outcome:
- Playbook section inputs are now a Notion-style rich-text editor (`components/ui/rich-text-editor.tsx`, Tiptap v3 StarterKit): markdown typing shortcuts + selection bubble toolbar (H1–H3, bold/italic/underline/strike, lists, quote, inline code, links).
- Content stored as HTML in the existing `sections` string map — no DB migration; legacy plain-text playbooks convert on load and stay editable.
- Side fix: repaired a pre-existing stale mock in `backtest-chart-grid.test.tsx` (broken by commit `3cf8559`'s `onToggleExpanded`→`onSelectView` rename) so the suite is green.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (829 tests), `npm run build` — all pass.
- Manual smoke by Jared: every shortcut/feature tested in dev, all good.

### News Section Redesign — Headline List + Inline Article Reader

Status: completed 2026-06-10 (commit `3dabcd0`, reviewed against spec).

Outcome:
- Research News tab is now a two-level UI: a card list of headlines (`relative time · absolute datetime · bold title`, no source label) that swaps into a full inline article reader with `← Back`, a `$TICKER` badge, long datetime, optional "Open original ↗", and the body split into paragraphs.
- Added `url` to `ResearchSnapshotNewsItem` (sourced from EODHD `link`) and two formatters in `lib/askedgar-utils.ts` (`formatRelativeTime`, `formatDateTimeLong`); dropped the dead Groq/JMT415 `formType` source logic.
- Post-review tweak: article body bumped `text-sm` → `text-base` per Jared.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (825 tests) — all pass.
- Manual dev-server smoke by Jared: list, reader swap, and "Open original" all good.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
