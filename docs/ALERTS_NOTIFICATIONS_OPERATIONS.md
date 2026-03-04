# Alerts and Notifications Operations Runbook

## Purpose

This runbook documents how to operate price-alert evaluation and Discord notification delivery using the durable DB-backed notification queue.

## Components

- Alert evaluator endpoint: `POST /api/discord/alerts/evaluate`
- Durable notification queue table: `notification_jobs`
- Notification processor endpoint: `POST /api/notifications/process`
- Combined scheduled job endpoint: `POST /api/cron/alerts`

## Authentication

### Service endpoints

- `/api/discord/alerts/evaluate` requires a valid service JWT (`Authorization: Bearer <jwt>`).

### Cron endpoints

- `/api/cron/alerts` and `/api/notifications/process` require:
  - `Authorization: Bearer $CRON_SECRET`

## Scheduler Configuration

Recommended cadence:

1. Run `POST /api/cron/alerts` every 1 minute.
2. Optionally run `POST /api/notifications/process` every 1 minute as a backup processor.

Example cron request payload:

```json
{
  "maxAlerts": 200,
  "processLimit": 100
}
```

## Manual Execution

### Combined evaluate + process run

```bash
curl -X POST "$APP_URL/api/cron/alerts" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxAlerts":200,"processLimit":100}'
```

### Process queue only

```bash
curl -X POST "$APP_URL/api/notifications/process" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit":100}'
```

## Response Fields

### `/api/cron/alerts`

- `runId`: correlation id for logs
- `evaluation.evaluated`: alerts scanned
- `evaluation.triggered`: alerts marked triggered
- `evaluation.queuedNotifications`: queue jobs inserted
- `evaluation.duplicateNotifications`: dedupe drops
- `dispatch.sent`: successful DM deliveries
- `dispatch.failed`: delivery failures this run
- `dispatch.retried`: jobs re-scheduled for retry
- `dispatch.dead`: jobs that hit max attempts

## Common Failures

1. `401 Unauthorized`
- Cause: missing or incorrect `CRON_SECRET` or service JWT.
- Action: verify scheduler header value and environment variables.

2. `503 Database not configured`
- Cause: `DATABASE_URL` missing or unavailable.
- Action: confirm runtime env and database connectivity.

3. Rising `dispatch.failed` or `dispatch.dead`
- Cause: invalid/missing `DISCORD_BOT_TOKEN`, Discord API errors, or content issues.
- Action: verify bot token, inspect logs by `runId`, and requeue if needed.

4. `queuedNotifications` stays zero while alerts trigger
- Cause: no linked Discord users (`discord_user_links`) or dedupe suppression.
- Action: verify account linking and inspect dedupe key windows.

## Environment Variables

- `DATABASE_URL`
- `CRON_SECRET`
- `DISCORD_BOT_TOKEN`
- `SCHWAB_API_BASE_URL` (optional override)
- `TRADE_WEBHOOK_SECRET` / `TRADE_WEBHOOK_SECRET_PREVIOUS` (service JWT verification)
