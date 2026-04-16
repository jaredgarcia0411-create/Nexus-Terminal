# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-16
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived on `2026-04-16` to keep this file focused. Agent Hardening #1 shipped in commit `7118598`; Agent Hardening #2 (trust boundary in prompt assembly) shipped in commit `2a856f1`; Agent Hardening #3 (memory / retention TTL-on-read) shipped in commit `bf13567`. See git history and `specs/` for the full implementation records.

## Current State

**Active spec:** None.

Agent Hardening #1 through #3 are shipped and archived from this file. The next hardening item is approval gates plus spend enforcement from `FUTURE-PLANS.md`.

## Validation Snapshot

Most recent validation (`2026-04-16`, post-commit `bf13567`):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`48` files, `378` tests)
- `npm run workflow:audit` — passed

## Recently Completed

### Agent Hardening #3 — Memory / Retention TTL-on-Read

- `lib/agents/memory.ts` now filters expired memory rows on read and applies category-based default TTLs when callers omit `expiresAt`.
- `lib/agents/context.ts` now limits conversation history to the last 30 days and narrows chat context by `sessionId` when present.
- `lib/agents/blueprint-runner.ts` now threads `job.input.session_id` into `buildContext()` for chat jobs without changing non-chat behavior.
- Added `app/api/cron/agent-retention/route.ts` and a daily Vercel cron entry to purge expired `agent_memory_v2` rows and `agent_request_log` rows older than 90 days.
- Added regression coverage for TTL-on-read, default TTL resolution, session-scoped context queries, and the retention cron route.
- Preserved the existing explicit thesis expirations in the small-cap and swing-trader research blueprints.

## Follow-Up Notes

- Production check: after deploy, verify `GET /api/cron/agent-retention` returns `200` when called with the existing project `CRON_SECRET`.
- Future hardening work: the next planned item is approval gates plus real spend enforcement. Retention work is otherwise complete unless product policy changes require different TTLs or wider cleanup coverage.
