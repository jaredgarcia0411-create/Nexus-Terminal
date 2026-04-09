# Agents Deploy Smoke

This is the canonical AEV2-509 launch checklist for the Sprint 4 agent stack.

Run the checklist in order. Do not skip ahead. This file mirrors the External Validation Checklist in `HANDOFF.md` and is intentionally manual.

Use `docs/ops/agents-launch-validation.md` for the detailed env and config parity walkthrough before the first `docker compose up -d`.

## Before the user runs the smoke

- [ ] **Populate `DISCORD_USER_MAP` in `lib/agents/admin.ts`.**
Add at least one real Discord user mapping to a real Nexus user `{ id, email, name, picture }`. Without this, the Discord bot will receive `403 Unknown Discord user` for every inbound message. Sprint 4 intentionally keeps this mapping hardcoded and does not introduce a `discord_user_links` table.

- [ ] **Fill `services/.env`.**
Confirm every variable from `services/.env.example` has a real value in `services/.env`. Pay special attention to `NEXUS_API_URL`, `AGENT_SERVICE_KEY`, `AGENT_ADMIN_KEY`, and all six `DISCORD_WEBHOOK_*` URLs. `NEXUS_API_URL` must be the public Vercel domain, not `localhost`.

For the deeper re-validation flow, use `docs/ops/agents-launch-validation.md`.

- [ ] **Verify Vercel env vars match `services/.env`.**
Specifically confirm `AGENT_SERVICE_KEY` and `AGENT_ADMIN_KEY` are present in Vercel and match the values in `services/.env`. The Nexus API rejects bot calls if the service key differs between Vercel and the Docker-side env file.

- [ ] **Confirm a Neon backup branch exists before any Compose-side migration.**
Sprint 4 ships no new migration, but launch readiness still assumes a usable Neon backup branch exists. If the exact branch ID is unknown, capture it in `docs/ops/agents-backup-restore.md` during this process.

- [ ] **Record tested-restore verification in `docs/ops/agents-backup-restore.md`.**
Use the operator-owned section in that runbook to record whether a restore drill has been executed, which branch was used, and any verification notes. If no restore drill has been run yet, note that explicitly and complete it before claiming launch readiness.

- [ ] **Sleep / power management on the home server.**

Confirm the host has sleep disabled so Docker remains available:

```sh
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

## After Codex hands off

- [ ] **`docker compose -f services/docker-compose.yml config` exits 0 and shows the four expected services with no Redis.**
Run:

```sh
docker compose -f services/docker-compose.yml config
```

Expected result: `discord-bot`, `orchestrator`, `small-cap-trader`, and `swing-trader` are present. No Redis service should appear.

- [ ] **`docker compose -f services/docker-compose.yml build` completes without errors for all four services.**
Run:

```sh
docker compose -f services/docker-compose.yml build
```

Expected result: all four images build successfully. Note any individual image build that takes longer than 5 minutes.

- [ ] **`docker compose -f services/docker-compose.yml up -d` brings all four containers up.**
Run:

```sh
docker compose -f services/docker-compose.yml up -d
docker compose -f services/docker-compose.yml ps
```

Wait about 60 seconds before trusting health state. Expected result: `orchestrator`, `small-cap-trader`, and `swing-trader` report `healthy`; `discord-bot` is `Up` and running. If an agent service shows `unhealthy`, inspect `docker compose -f services/docker-compose.yml logs <service>` for a heartbeat write failure. If `discord-bot` exits, inspect `docker compose -f services/docker-compose.yml logs discord-bot`.

- [ ] **Discord `#orchestrator` smoke — handle-directly.**
Post a plain message such as `what's the market doing today?` in Discord `#orchestrator`.
Expected result: within 60 seconds, the bot replies with an Orchestrator embed. Verify the embed color is emerald and the title is `Orchestrator Reply`.

- [ ] **Discord `#orchestrator` smoke — routed-to-specialist.**
Post:

```text
/research AAPL
```

Expected result: within 30 seconds, the bot replies with `Your request was routed to a specialist job: <id>.` The Small Cap Trader then posts a research embed in `#small-cap-research` within about 120 seconds, depending on AskEdgar latency.

- [ ] **Discord `#orchestrator` smoke — offline-fallback.**
Stop the specialist:

```sh
docker compose -f services/docker-compose.yml stop small-cap-trader
psql "$DATABASE_URL" -c "SELECT id, status FROM agent_registry WHERE id = 'small-cap-trader';"
```

Wait until `agent_registry.status = 'offline'`. The SIGTERM path should usually flip the status within 10 seconds and is capped by `stop_grace_period: 30s`.

Post `/research AAPL` again in `#orchestrator`.

Expected result: the Orchestrator falls back to handling the request directly and includes a warning in the response. Restart the specialist afterward:

```sh
docker compose -f services/docker-compose.yml start small-cap-trader
```

- [ ] **Macro summary smoke.**
Run:

```sh
curl https://<your-domain>/api/agents/macro-summary/latest
```

Expected result: the route returns the previous day's summary if one already exists.

To force a fresh summary, temporarily set `MACRO_CRON_HOUR` in `services/.env` to the current ET hour, then restart the orchestrator service:

```sh
docker compose -f services/docker-compose.yml up -d orchestrator
```

Wait one cron tick, about 60 seconds, then verify the newest row exists:

```sh
psql "$DATABASE_URL" -c "SELECT id, report_type, created_at FROM agent_reports WHERE report_type = 'macro-summary' ORDER BY created_at DESC LIMIT 1;"
```

Expected result: a new `macro-summary` report row appears and the embed posts in `#macro-daily`. Revert `MACRO_CRON_HOUR` to `6` afterward.

- [ ] **Admin stats smoke.**
Run:

```sh
curl -H "x-agent-admin-key: $AGENT_ADMIN_KEY" https://<your-domain>/api/agents/admin/stats
```

Expected result: the response matches the `AdminStatsResponse` contract and includes non-null `agents`, `circuitBreakers`, and `queue.depth` fields.

- [ ] **Admin redeliver smoke.**
Pick one report id from `agent_reports`, then run:

```sh
curl -X POST \
  -H "x-agent-admin-key: $AGENT_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"report_id":"<id>"}' \
  https://<your-domain>/api/agents/admin/redeliver
```

Expected result: the response returns `{ report_id, status: 'published' }` and the embed re-posts in the matching Discord channel.

- [ ] **Observability SQL smoke.**
Run each block from `scripts/ops/agent-observability.sql` in Drizzle Studio or `psql`.

Expected result: every block executes without error and returns sensible values for the live environment.

- [ ] **Restart resilience.**
Run:

```sh
docker compose -f services/docker-compose.yml restart orchestrator
docker compose -f services/docker-compose.yml ps
```

Expected result: within 90 seconds, the orchestrator returns to `healthy`, the heartbeat row is fresh, and the bot still responds to `#orchestrator` messages.

- [ ] **Logging tail.**
Run:

```sh
docker compose -f services/docker-compose.yml logs --tail=100 orchestrator small-cap-trader swing-trader discord-bot
```

Expected result: no secrets appear in logs. The new entrypoint and `discord-bot` output should be structured JSON. Existing `lib/agents/*` runtime lines may remain plain text. Crash loops or repeated stack traces are failures.

- [ ] **Power-loss simulation (optional).**
Run:

```sh
sudo reboot
```

Expected result: Docker autostarts and all four agent services return under `restart: unless-stopped`.

## After the smoke passes

- [ ] **Flip Sprint 4 status in `HANDOFF.md` to COMPLETE.**

After the operator finishes the smoke and signs off, re-run the planning pass to collapse Sprint 4 into the same 3-block format as Sprints 1 through 3.

- [ ] **Update `AEV2_PLAN.md`.**

Mark EPIC-5 stories `AEV2-501` through `AEV2-510` as DONE.

- [ ] **Tag the launch commit.**

Create a known-good launch tag such as:

```sh
git tag aev2-v1-launch
```

Expected result: the rollback runbook has a stable deploy target for future rollbacks.
