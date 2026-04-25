# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-24
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20); Spend Enforcement Fix shipped across `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix shipped in `0e96e16` (2026-04-22); Research Chart History Polish shipped in `5fc5b9e` (2026-04-22); System Sheet Sync shipped in `63c3a3b` + `a694797` (2026-04-23); AskEdgar Gap-Stats Mapper Fix shipped in `aa3ea65` (2026-04-24). See git history for full records.

## Current State

**Active spec:** None.

## Validation Snapshot

Most recent validation (`2026-04-24`, AskEdgar Gap-Stats Mapper Fix):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`55` files, `425` tests)
- `npm run workflow:audit` — passed

## Follow-Up Notes

- **AskEdgar paid API migration (Monday 2026-04-27).** Test key expires Monday. `https://eapi.askedgar.io` remains the correct base URL — the readme.io docs list `https://api.askedgar.com`, which redirects to a HugeDomains parking page. Only swap the `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts:42`.
- **Cost-per-report estimate (after dropping `filing-titles` and `historical-float-pro`).** Per the free `/estimate` endpoint at `https://eapi.askedgar.io/estimate?endpoint={name}&ticker={t}` with no auth, an unbounded fresh report on a heavy-activity microcap (SPRC) costs ~$3.33 across 15 working endpoints (dilution-data /estimate is broken upstream so excluded). Dropping `filing-titles` (~$1.56) and `historical-float-pro` (~$0.63) brings the upper bound to **~$1.14 per fresh report**. The `limit` and filter parameters are honored by the real endpoints but ignored by `/estimate`, so real costs on `news` (limit=20) and `offerings` (limit=20) will run lower than the upper bound. With the 1-hour `(ticker)` cache, ~10 unique tickers per day projects to roughly **$5–$10/day** after the endpoint trim.
- **Endpoint trim (separate future spec).** Drop `filing-titles` and `historical-float-pro` from the `endpointConfigs` array in `lib/askedgar.ts:481-499`, plus the corresponding helper functions (`fetchHistoricalFloatPro`, `fetchFilingTitles`) and any consumer references in `lib/agents/blueprints/`. Confirm nothing reads from `rawData['filing-titles']` or `rawData['historical-float-pro']` before removing.
- **Cost telemetry (separate future spec).** AskEdgar v1 responses include a `usage.cost_microdollars` field. Once the paid key is live, log this per call (or per report) so we have real spend numbers instead of estimates.
- **Ask Edgar replacement research** is in `docs/ae-buildout.md`. `FUTURE-PLANS.md` and `AGENTIC_EXPANSIONV2.md` live under `docs/`.

