# Nexus Terminal — Handoff Document

**Generated:** 2026-03-04
**Current Branch:** `main`

## Current Status

Workstreams **1 through 13** are implemented in code.

### Validation Snapshot

- `npm run lint` passed
- `npx tsc --noEmit` passed
- `npm test` passed (**13 files, 58 tests**)

## Implemented in This Session

### Workstream 11.3: Compatibility Cleanup

- Removed legacy default shared-secret Authorization fallback from Discord bot API client (`services/discord-bot/src/utils.ts`).
- Bot API calls now require explicit scoped JWT headers.
- Updated compatibility status notes in `docs/SERVICE_AUTH_SCOPES.md`.

### Workstream 12: Test Coverage Expansion (Completed)

Added and passing:

1. Service token and auth tests
- `__tests__/service-token.test.ts`
  - valid token, wrong secret, previous-secret rotation, expiry/malformed handling, scope checks
- `__tests__/service-request.test.ts`
  - missing auth, insufficient scope, replay rejection, valid scoped+replay path

2. Route-level service tests
- `__tests__/webhook-trade-event-route.test.ts`
  - auth rejection, no-link short-circuit, enqueue + dedupe counters
- `__tests__/alerts-evaluate-route.test.ts`
  - DB unavailable, auth rejection, evaluation summary path
- `__tests__/notifications-process-route.test.ts`
  - cron auth rejection, DB unavailable, processor metrics response
- `__tests__/discord-link-code-route.test.ts`
  - code generation path, missing claims rejection, invalid code rejection, successful code claim/link

3. Notification processor transition tests
- `__tests__/notification-jobs.test.ts`
  - sent, retried, dead-by-attempt-limit, dead-without-bot-token transitions

4. Strategy parity tests
- `__tests__/backtest-strategy-parity.test.ts`
  - TS engine vs Python worker comparison for:
    - `sma-crossover`
    - `mean-reversion`
    - `breakout`
  - Explicit tolerances documented in test comments:
    - trade count delta <= 1
    - win rate delta <= 0.15
    - total PnL delta <= 300
    - max drawdown delta <= 500
    - final equity delta <= 300

### Workstream 13: Repository Hygiene (Completed)

- Artifact ignore policy encoded in `.gitignore`:
  - `services/*/dist/`
  - `services/**/__pycache__/`
  - `tsconfig.tsbuildinfo`
- Validation matrix documented:
  - `docs/VALIDATION_MATRIX.md`
- Removed tracked Python cache artifact:
  - `services/backtest-worker/__pycache__/main.cpython-312.pyc`

## Previously Implemented (in current branch)

### Workstream 10: Reliability and Operations

- Durable DB-backed queue (`notification_jobs`)
- Alert evaluator + webhook enqueue integration
- Scheduler endpoints (`/api/cron/alerts`, `/api/notifications/process`)
- Ops runbook (`docs/ALERTS_NOTIFICATIONS_OPERATIONS.md`)

### Workstream 11.1 and 11.2: Scoped Service JWT + Replay Mitigation

- Route-level scope enforcement
- `jti` replay protection via `service_token_jtis`
- Bot scoped token minting with per-request `jti`
- Scope matrix (`docs/SERVICE_AUTH_SCOPES.md`)

## Remaining Work

No in-repo implementation workstreams remain from the active plan.

## Operational Follow-up (External to Code)

1. Scheduler platform wiring
- Configure deployment scheduler to call `/api/cron/alerts` at desired cadence (recommended 1 minute).

2. Environment readiness
- Ensure `CRON_SECRET`, `DISCORD_BOT_TOKEN`, `DATABASE_URL`, and service JWT secrets are configured in deployment.

3. Service package build environment
- Install service-local dependencies in CI/service workspaces before running package-level builds (e.g., Discord bot `tsc`).
