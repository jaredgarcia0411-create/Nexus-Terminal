# CLAUDE.md

This file is a thin Claude-specific adapter. `AGENTS.md` is the canonical workflow and repo guidance.

## Read Order

1. Read `AGENTS.md`.
2. Read `HANDOFF.md` to check whether an active execution spec exists.
3. If `HANDOFF.md` contains an active spec, follow it in order. If not, treat it as recent-context summary and rely on the live repo plus `AGENTS.md`.

## Validation

Run from repo root after changes:

- `npm run lint`
- `npx tsc --noEmit`
- `npm run typecheck:services` when touched files include `services/`
- `npm test`

If workflow assets changed under `AGENTS.md`, `HANDOFF.md`, `.claude/`, `.opencode/`, or `codex-skills/`, also run `npm run workflow:audit`.

## Route and Auth Rules

- Default user-scoped routes use `requireUser()`.
- Cron routes use `requireCronSecret()`.
- Agent admin routes use `requireAgentAdmin()`.
- Agent service routes use `requireServiceAuth()` or `requireServiceKey()`.
- Validate JSON request bodies with `parseAndValidate()` and Zod v4 `z.flattenError(...)`.

## Architecture Reminders

- Keep page-level orchestration in `app/page.tsx`.
- API handlers live in `app/api/**/route.ts`.
- SSE routes use `lib/sse.ts`, `export const dynamic = 'force-dynamic'`, and `export const maxDuration = 60`.
- Use cached AskEdgar helpers from `lib/askedgar.ts`.
- Do not add new logic to `hooks/use-trades.ts`.
- Module-level memory is not durable on Vercel; use the database or an external store for persistent state.

## Workflow Surface Rules

- Keep this file short and Claude-specific. Do not duplicate large architecture inventories here.
- When updating Claude commands, hooks, or agents, align them back to `AGENTS.md`.
- Do not add stale counts, speculative "not yet built" notes, or tool-specific personas that are not grounded in the live repo.
