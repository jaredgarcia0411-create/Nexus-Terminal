# Agents Rollback

Purpose: recover the Sprint 4 agents stack when a deploy, Docker rollout, or migration step needs to be reversed.

Use this runbook when:
- The Vercel deployment is unhealthy and you need to move traffic back to the last known-good build.
- The Docker services need to be reverted to a known-good tag or commit.
- Migration `0019_clever_zodiak.sql` was only partially applied and must be cleaned up before a re-migrate.

This runbook only uses repo-supported commands and the live artifacts in this worktree. It does not invent extra scripts.

## 1. Roll back the Vercel deployment

Use Vercel rollback when the app-side deploy is the problem and the previous production deployment is still healthy.

1. Identify the last green production deployment in Vercel.
2. Roll back to that deployment with the Vercel CLI:

```sh
vercel rollback
```

3. If the CLI prompts for a deployment target, select the last known-good production deployment.
4. Confirm the production URL serves the expected app version.

After the rollback:
- Re-check the app routes that the Sprint 4 docs depend on.
- Confirm the agent API endpoints still point at the expected production host.
- Make sure the rollback did not change any secrets or service keys.

## 2. Roll back the Docker services

Use Docker rollback when the service containers need to return to a known-good Git state.

1. Stop the running stack:

```sh
docker compose -f services/docker-compose.yml down
```

2. Move the repo to a known-good tag or commit:

```sh
git checkout <known-good-tag-or-commit>
```

3. Rebuild and start the services:

```sh
docker compose -f services/docker-compose.yml up -d --build
```

4. Watch the service health:

```sh
docker compose -f services/docker-compose.yml ps
```

Expected state:
- `orchestrator`, `small-cap-trader`, and `swing-trader` should become `healthy`.
- `discord-bot` should stay `Up` and remain attached to the guild channel.

If the stack is being rolled back after a bad tag:
- Keep the rollback target explicit in the Git history.
- Do not cherry-pick unrelated changes into the recovery step.
- Re-run the launch validation checklist after the services come back.

## 3. Recover from a partially applied migration 0019

Migration `0019_clever_zodiak.sql` created the agent tables and seed rows for Sprint 4. If a future re-migrate needs a clean slate, drop the new tables in reverse foreign-key order before re-running the migration.

Important:
- Do not drop `public.users`.
- Do not invent a shortcut that bypasses the FK order.
- This is a manual recovery block, not a replacement for the migration itself.

Run this in `psql` against the affected branch:

```sql
BEGIN;

DROP TABLE IF EXISTS "agent_step_effects";
DROP TABLE IF EXISTS "agent_scheduled_runs";
DROP TABLE IF EXISTS "agent_reports";
DROP TABLE IF EXISTS "agent_request_log";
DROP TABLE IF EXISTS "agent_memory_v2";
DROP TABLE IF EXISTS "agent_job_checkpoints";
DROP TABLE IF EXISTS "agent_conversations";
DROP TABLE IF EXISTS "agent_jobs";
DROP TABLE IF EXISTS "agent_registry";

COMMIT;
```

Why this order:
- `agent_step_effects` depends on `agent_jobs`.
- `agent_scheduled_runs`, `agent_reports`, `agent_request_log`, `agent_memory_v2`, `agent_job_checkpoints`, and `agent_conversations` all depend on `agent_jobs` and/or `agent_registry`.
- `agent_jobs` depends on `agent_registry` and `users`.
- `agent_registry` is the root table for the agent-specific FK graph.

If the partial failure also left seed rows in place:
- Re-run the migration after the drop block above.
- Verify the seed rows are present again after the clean re-migrate.

## 4. Verify the rollback

After any rollback path, confirm the stack is back in a known-good state.

Checks to run:

```sh
docker compose -f services/docker-compose.yml ps
```

```sh
psql "$DATABASE_URL" -c "SELECT id, status FROM agent_registry ORDER BY id;"
```

```sh
psql "$DATABASE_URL" -c "SELECT id, report_type, status FROM agent_reports ORDER BY created_at DESC LIMIT 5;"
```

What to confirm:
- The expected agent services are running again.
- The database still contains the seeded Sprint 4 agent registry rows if the migration was kept.
- No partial migration artifacts remain if you ran the manual drop block.
- The app and agent endpoints respond normally before you declare recovery complete.

## 5. Aftercare

Once rollback is complete:
- Record the reason for the rollback and the exact target you rolled back to.
- Re-run the launch validation checklist before any new deploy.
- If you had to use the migration recovery block, note the branch and timestamp in the backup/restore runbook as well.
