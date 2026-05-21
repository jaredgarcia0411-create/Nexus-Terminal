# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-21
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

There is no active execution spec in this file right now. Use `AGENTS.md` for workflow rules and `docs/ARCHITECTURE.md` for repo structure before starting new work.

---

## Open Follow-Ups

- **Offerings extractors fresh-ticker smoke check**: the 2026-05-19 offerings broadening shipped, but the WNW manual smoke was inconclusive because the Research snapshot was cached. Next time Research is opened on a fresh ADS / FPI ticker whose `askedgar_cache` row has expired or does not exist, confirm Shares / Price / Amount populate for at least one priced row in Past Offerings. If every value is `--`, capture the filing URL from the row's SEC link and open a follow-up spec for the missing phrasing variant.

---

## Recently Completed

### Repo Cleanup Audit Refresh

Status: completed 2026-05-21.

Outcome:
- `docs/repo-cleanup.md` was refreshed from a repo-wide current-state audit.
- Completed/stale May 11 cleanup findings were removed from the active backlog.
- New recommendations were grouped by security/reliability, external-call efficiency, route/product-surface cleanup, frontend simplification, tests/dead weight, and docs/workflow drift.
- The audit used parallel read-only reviewers plus local verification before updating the doc.

Validation:
- `npm run workflow:audit` passed during the audit pass.
- `git diff --check -- docs/repo-cleanup.md` passed.
- Scope check showed only `docs/repo-cleanup.md` changed before this HANDOFF compaction.

### Playbook Page In Management

Status: completed 2026-05-21.

Outcome:
- Added `playbook_strategies` storage, migration, validation/default helpers, `/api/playbook`, `PlaybookTab`, and Management sub-nav wiring.
- Follow-up polish made the page match the Management visual language: tighter panel radius, tag select from existing global tags, unified header controls, clearer section titles, and consistent delete styling.

Validation:
- Original implementation passed `npm run db:migrate`, `npm run lint`, `npx tsc --noEmit`, and `npm test`.
- Local sandbox `npm run dev` was blocked by `listen EPERM`; user ran `npm run dev` manually and reported the UI looked good.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
