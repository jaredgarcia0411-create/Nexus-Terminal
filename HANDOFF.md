# Nexus Terminal - HANDOFF.md

> Updated: 2026-10-05
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

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

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.


---

## Recently Completed

### Sheets: AH/PM Session Highs, Extension Ratio, Numeric Filters

Status: completed 2026-10-05 (commit 052966c).

Outcome:
- Six Massive-backed column types (`pdc`, `pd_range`, `ah_high`, `pm_high_early`, `pm_high_late`, `pm_extension`) filled by `fill-massive` from unadjusted 1-minute bars; windows only fill after they close.
- Numeric `>`/`>=`/`<`/`<=` filters with k/m/b suffixes on number, volume, float, and the new columns; blank cells never match.
- `isNyTradingDay` now skips a hardcoded NYSE holiday list (2024–2027) in `lib/time-utils.ts`; extend it yearly. Early-close half days are not modeled.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (113 files / 878 tests) all pass.
- Manual smoke (known past runner, `>0.33` + `>10m` filter) not yet run.
