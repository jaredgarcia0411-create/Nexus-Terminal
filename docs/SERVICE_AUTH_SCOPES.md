# Service Auth Scopes

This document defines required `scope` claims for service JWT access.

## Token Requirements

- `iss`: `nexus-service`
- `aud`: `nexus-api`
- `iat` / `exp`: issued-at and expiry
- `discordUserId`: required for user-linked service routes
- `scope`: required for scoped routes below
- `jti`: required on routes with replay enforcement

## Compatibility Status

- Legacy shared-secret bearer fallback is removed from the Discord bot API client.
- Service requests must provide scoped JWT Authorization headers.

## Route Scope Matrix

| Route | Method | Scope | Replay Enforced |
|---|---|---|---|
| `/api/trades` | GET | `trades:read` | No |
| `/api/schwab/market-data` | GET | `schwab:market-data:read` | No |
| `/api/schwab/sync` | POST | `schwab:sync` | Yes |
| `/api/backtest` | POST | `backtest:run` | Yes |
| `/api/backtest?jobId=...` | GET | `backtest:read` | No |
| `/api/discord/alerts` | GET | `alerts:read` | No |
| `/api/discord/alerts` | POST | `alerts:write` | Yes |
| `/api/discord/link/code` | POST | `link:code:create` | Yes |
| `/api/webhooks/trade-event` | POST | `webhooks:trade-event` | Yes |
| `/api/discord/alerts/evaluate` | POST | `alerts:evaluate` | Yes |

## Replay Store

Replay protection stores consumed `jti` values in `service_token_jtis` until token expiry.

- First use inserts `jti`.
- Reuse returns conflict (`409`) with `Service token replay detected`.
- Expired entries are cleaned up opportunistically during token consumption.
