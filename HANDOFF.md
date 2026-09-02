# Nexus Terminal - HANDOFF.md

> Updated: 2026-09-02
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

### Scale-In Folding: Execution Timestamps, Summed Risk, Matcher Additions

Status: completed 2026-09-02.

Outcome:
- Raw-imported executions now store an absolute ISO timestamp, so chart markers land on the session the fill actually happened on instead of the trade's entry day.
- Cross-day adds fold into the oldest surviving open position via a new `additions` channel on `matchExecutions`, instead of creating a second trade row.
- Risk sums when positions combine: the merge endpoint adds `initialRisk` across sources, and each folded scale-in adds one more unit of default risk (edit the trade to risk more or less).
- Both delete paths clear `raw|<day>|%` import fingerprints for every day a trade holds fills, so a folded trade's CSVs can be re-uploaded.
- No schema change, no migration. Historical executions keep null timestamps and fall back to today's behavior.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (112 files / 846 tests), `npm run build` — all pass.
- Review found and fixed two client-side bugs: the folded-risk sweep read a pre-sweep snapshot (undercounting risk when the base position and the add arrived in one upload), and import batches weren't date-sorted (out-of-order files would date the folded trade wrong).
