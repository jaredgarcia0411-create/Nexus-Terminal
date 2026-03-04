# Service Secret Rotation Playbook

This project uses short-lived signed service tokens (JWT, HS256) for bot-to-app authentication.

## Environment Variables

- `TRADE_WEBHOOK_SECRET`: active signing secret
- `TRADE_WEBHOOK_SECRET_PREVIOUS`: optional previous secret accepted during transition

Server-side verification accepts either secret while `TRADE_WEBHOOK_SECRET_PREVIOUS` is set.

## Zero-Downtime Rotation Steps

1. Generate a new random secret.
2. Deploy API with:
- `TRADE_WEBHOOK_SECRET=<new>`
- `TRADE_WEBHOOK_SECRET_PREVIOUS=<old>`
3. Restart/redeploy bot/service clients with:
- `TRADE_WEBHOOK_SECRET=<new>`
4. Wait at least one token TTL window (default 5 minutes) plus safety buffer.
5. Remove `TRADE_WEBHOOK_SECRET_PREVIOUS` from API environment.
6. Redeploy API.

## Validation Checklist

1. Bot commands still authenticate after step 3.
2. Old tokens fail after step 5.
3. New tokens continue to succeed after step 6.

## Emergency Rollback

1. Set API secrets back to:
- `TRADE_WEBHOOK_SECRET=<old>`
- unset `TRADE_WEBHOOK_SECRET_PREVIOUS`
2. Redeploy API.
3. Revert bot secret to `<old>` and redeploy bot.
