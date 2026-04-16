Scaffold planning for a new agent surface named: $ARGUMENTS

This command reflects the current Nexus agent architecture. Do not default to creating `lib/<agent>.ts` or `app/api/<agent>/route.ts`; those older paths are no longer the primary pattern.

## Before You Start

1. Read `AGENTS.md` and `HANDOFF.md`.
2. Read the current agent runtime files:
   - `lib/agents/config.ts`
   - `lib/agents/types.ts`
   - `lib/agents/blueprint-runner.ts`
   - `app/api/agents/**/route.ts`
   - `services/agent-entrypoint.ts`
3. Decide whether the requested work is:
   - a new blueprint in `lib/agents/blueprints/`
   - a prompt or policy addition in `lib/agents/prompts/`
   - a new route under `app/api/agents/`
   - a service/background wiring change under `services/`

## Current Scaffold Targets

- Blueprint logic: `lib/agents/blueprints/<slug>.ts`
- Prompt or formatting docs: `lib/agents/prompts/<slug>.md`
- Registry/config wiring: `lib/agents/config.ts`, `lib/agents/types.ts`, and relevant helpers
- API surface: `app/api/agents/.../route.ts` only when the agent needs a new HTTP entrypoint
- Service entrypoint wiring: `services/agent-entrypoint.ts` or `services/discord-bot/index.ts` only when background delivery requires it

## Rules

- Keep prompts and policies separate from transport glue.
- Use the auth helper that matches the route surface instead of assuming `requireUser()` everywhere.
- Validate request bodies with `parseAndValidate()`.
- If touched files include `services/`, run `npm run typecheck:services`.
- Finish with `npm run lint`, `npx tsc --noEmit`, and `npm test`.
