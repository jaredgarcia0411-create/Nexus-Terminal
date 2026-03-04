# Nexus Terminal — Implementation Plan

## Overview

Nexus Terminal is a Next.js 15 trading journal with Neon/PostgreSQL (Drizzle), NextAuth v5, Schwab integrations, Discord bot integrations, and a Python backtest worker.

As of **March 4, 2026**, Workstreams **1 through 13** are implemented in code.

## Completed Workstreams (Archived)

1. Custom login page + auth middleware
2. `app/page.tsx` decomposition into focused components/hooks
3. Backtesting tab implementation
4. Bug-fix and polish sprint
5. Turso to Neon/PostgreSQL + Drizzle migration
6. Tenant/auth hardening sprint
7. UI/UX hardening (critical, accessibility, polish)
8. Service-layer completion (Discord link flow, webhook forwarding, alert evaluator route, worker strategy expansion)
9. Service auth hardening baseline (short-lived service JWTs + secret rotation runbook)
10. Reliability/operations foundation
11. Service auth follow-up hardening (scopes, replay, compatibility cleanup)
12. Test coverage expansion (service auth, routes, queue transitions, strategy parity)
13. Repository hygiene baseline (artifact policy + validation matrix)

Do not re-run archived workstreams unless a regression is confirmed.

---

## Current Validation Baseline (2026-03-04)

- `npm run lint` passed
- `npx tsc --noEmit` passed
- `npm test` passed (13 files, 58 tests)

---

## Open Follow-ups (Operational)

These are deployment/operations tasks, not missing code workstreams.

1. Scheduler wiring
- Configure production scheduler to invoke `POST /api/cron/alerts` at desired cadence.

2. Environment provisioning
- Ensure all required secrets are configured:
  - `CRON_SECRET`
  - `DISCORD_BOT_TOKEN`
  - `DATABASE_URL`
  - `TRADE_WEBHOOK_SECRET` / `TRADE_WEBHOOK_SECRET_PREVIOUS`

3. Service package build readiness
- Ensure service-local dependencies are installed in CI/service environments before package builds.

---

## Key References

- Notification operations runbook: `docs/ALERTS_NOTIFICATIONS_OPERATIONS.md`
- Service scope matrix: `docs/SERVICE_AUTH_SCOPES.md`
- Secret rotation playbook: `docs/SECRET_ROTATION.md`
- Validation matrix: `docs/VALIDATION_MATRIX.md`
