# Agents Launch Validation

Use this checklist before `docker compose -f services/docker-compose.yml up -d` on a launch candidate. This is the canonical env/config parity gate for Sprint 4.

## Scope

- Re-verify the values that live in `services/.env`
- Re-verify the Vercel dashboard values that must match `services/.env`
- Re-run the service typecheck gate before starting the stack
- Confirm the Docker healthcheck assumptions still match the worker heartbeat window

## Source of truth

Use `services/.env.example` as the field list, then compare the real values in:

- `services/.env`
- the Vercel dashboard

Do not invent new variables. Do not omit variables that are required by the compose file.

## Required re-checks

### 1. Lane keys, base URLs, and models

Re-verify the following from `services/.env.example`:

- `INTERACTIVE_LLM_API_KEY`
- `INTERACTIVE_LLM_API_BASE_URL`
- `INTERACTIVE_LLM_MODEL`
- `INTERACTIVE_LLM_TIMEOUT_MS`
- `BACKGROUND_LLM_API_KEY`
- `BACKGROUND_LLM_API_BASE_URL`
- `BACKGROUND_LLM_MODEL`
- `BACKGROUND_LLM_TIMEOUT_MS`

These should still match the intended interactive lane and background lane configuration.

### 2. Discord bot and service auth

Re-verify these values separately:

- `NEXUS_API_URL`
- `AGENT_ADMIN_KEY`
- `AGENT_SERVICE_KEY`

`NEXUS_API_URL` must point at the public Vercel domain, not `localhost`.

### 3. Discord webhooks

Re-verify all six webhook URLs from `services/.env.example`:

- `DISCORD_WEBHOOK_SCANS`
- `DISCORD_WEBHOOK_RESEARCH`
- `DISCORD_WEBHOOK_SWING_SETUPS`
- `DISCORD_WEBHOOK_SWING_ALERTS`
- `DISCORD_WEBHOOK_MACRO_DAILY`
- `DISCORD_WEBHOOK_SYSTEM`

Do not paste the URLs into this doc. Record only that each value is present and matches the expected channel.

### 4. Vercel parity

Confirm the Vercel environment contains the same values as `services/.env` for:

- `AGENT_ADMIN_KEY`
- `AGENT_SERVICE_KEY`

These two keys must match exactly between Vercel and the local `services/.env` file.

## Canonical typecheck procedure

Run the service TypeScript gate before starting the stack:

```sh
npm run typecheck:services
```

This command is the canonical Checkpoint 4/6 service typecheck gate. Run it from the repo root after the one-time `cd services/discord-bot && npm ci` bootstrap has already been completed.

## Launch order

1. Verify the env values above.
2. Run `npm run typecheck:services`.
3. Start the stack:
   ```sh
   docker compose -f services/docker-compose.yml up -d
   ```
4. Wait for the healthcheck window to pass.
5. Run:
   ```sh
   docker compose -f services/docker-compose.yml ps
   ```

## Healthcheck timing note

The compose healthcheck uses `find -mmin -2` against `/tmp/healthy`. That file is refreshed by `lib/agents/heartbeat.ts` on a 30-second interval, which is separate from the 60-second job-lease heartbeat in `lib/agents/worker.ts`. If the health-file heartbeat interval changes materially, the healthcheck window and this runbook must be updated together.

## Verification checklist

- `services/.env` matches the intended lane keys, base URLs, models, and Discord webhook URLs
- `NEXUS_API_URL` is the public Vercel domain
- `AGENT_ADMIN_KEY` matches between Vercel and `services/.env`
- `AGENT_SERVICE_KEY` matches between Vercel and `services/.env`
- `npm run typecheck:services` exits 0
- `docker compose -f services/docker-compose.yml up -d` exits 0
- `docker compose -f services/docker-compose.yml ps` shows the expected health state

## Notes

- Keep this runbook focused on launch validation, not smoke execution.
- The smoke checklist lives in `agents-deploy-smoke.md`.
- If the env contract changes, update `services/.env.example` first, then this doc.
