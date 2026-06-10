# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-10
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-16, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Sheets Sprints 1-7 + Massive Wave 1-2, backtest user-id fixes, Filing headline parser, Calendar Year Overview, Workflow Maintenance, Nav Reorg, Sheets Today-filter + report-by-ticker/date) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## Open Follow-Ups

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

---

## Recently Completed

### Replace Ask Edgar News with EODHD News API

Status: completed 2026-06-10 (commit `6b10607`, reviewed against spec).

Outcome:
- News now sourced from EODHD `GET /api/news` via new `lib/eodhd.ts` (`fetchEodhdNews`), wired into the `news` registry key so it inherits the 15-min cache; `fetchNews`/Ask Edgar `/v1/news` removed.
- Both consumers repointed at EODHD fields (`title/content/date/link/tags/sentiment`): `news-formatter.ts` (`buildNewsItem` + sentiment label, LLM/Discord) and `snapshot-normalizer.ts` (UI); filing fallback dropped — Filings tab is now `sec-filings`-only.
- `small-cap-research` date-key fix (`date` added) keeps news-recency signals working; research prompt de-references `form_type`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (825 tests), `npm run build` — all pass.
- Leftover-symbol grep clean; EODHD tests added/updated.
- Manual smoke (News populates, Filings renders, agent runs, 15-min cache coalesce) still owed by Jared once `EODHD_API_KEY` confirmed in all envs.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
