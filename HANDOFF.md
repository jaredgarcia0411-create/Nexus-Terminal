# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-27
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Recent ships: Agent Hardening #1 (`7118598`), #2 (`2a856f1`), #3 (`bf13567`); Research agent report refinements (`9a69655`, 2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) across `4757fa3`/`0e41b5a`/`8dd6b12`/`fe97e8c`/`c300153` (2026-04-19→20); Tighten Trading Journal UI (`f1fde41`, 2026-04-20); Spend Enforcement Fix across `7aad160`/`abdefe9`/`1bd5e1e`/`8ad674e`/`9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix (`0e96e16`, 2026-04-22); Research Chart History Polish (`5fc5b9e`, 2026-04-22); System Sheet Sync (`63c3a3b` + `a694797`, 2026-04-23); AskEdgar Gap-Stats Mapper Fix (`aa3ea65`, 2026-04-24); AskEdgar Conditional Fan-Out + Cost Telemetry (`29a3820`, 2026-04-27); SEC EDGAR Foundations + Filing-Titles Replacement (`b4a3e73`, 2026-04-27).

## Current State

**No active spec.** AskEdgar Sprint 1 (SEC EDGAR foundations + `filing-titles` swap) shipped in `b4a3e73` and validated 2026-04-27. Awaiting `npm run db:push` against Neon and a push to `origin/main`, then ready to plan Sprint 2.

## Validation Snapshot

Most recent validation (`2026-04-27`, post-`b4a3e73` re-run):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (58 files, 447 tests)
- `npm run workflow:audit` — passed

## Pre-Push Reminders for Jared

- **Run `npm run db:push`** against Neon before pushing `b4a3e73`. The new `sec_ticker_cik` table must exist before the first request hits `loadCikMap()` — otherwise the in-memory fallback works but the table never gets seeded and every cold start re-fetches ~10,300 rows from SEC.
- **First request after deploy** will log `[sec-cik-map] loaded N entries from SEC` (cold load). Subsequent requests within 24h log `[sec-cik-map] hydrated N entries from db`. Confirm both messages appear at least once before declaring the rollout healthy.
- **No SEC API key needed** — `data.sec.gov` and `www.sec.gov/files/` are free, only require the `Nexus Terminal jared.garcia0411@gmail.com` User-Agent (already hardcoded in `lib/sec/client.ts:1`).
- **Smoke check on a known-bad ticker** (e.g. `ZZZZZ`): the `[sec-submissions] no CIK for ticker` warning should fire and the report should still complete with an empty filings list.

## Follow-Up Notes

- **AskEdgar paid API migration (today, Monday 2026-04-27).** Test key expires today. `https://eapi.askedgar.io` remains the correct base URL — the readme.io docs list `https://api.askedgar.com`, which redirects to a HugeDomains parking page. Only swap the `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles` from the AskEdgar fan-out, so projected daily spend at ~10 unique tickers/day falls below the post-trim ~$5–$10/day estimate. Measure with the `[askedgar-fanout]` log's `costUsd` token over the next few report runs.
- **News-formatter UX trade.** Filing feeds now default to `${formType} filing` labels (e.g. "8-K filing") via the existing fallback in `lib/agents/news-formatter.ts:198`. AI headlines are deferred to buildout-doc Phase 8 (`docs/ae-buildout.md:396`).

## Next Up: AskEdgar Sprint 2 — `historical-float-pro` via XBRL companyfacts

When ready to plan, the target is to replace AskEdgar's `historical-float-pro` endpoint with SEC XBRL companyfacts (`https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`). The shared SEC client + CIK map from Sprint 1 are reusable as-is. The new work is:

- A new `lib/sec/companyfacts.ts` module that fetches the companyfacts JSON, picks the right share-count concept (`CommonStockSharesOutstanding` or `EntityCommonStockSharesOutstanding` depending on filer), and emits historical share-count snapshots keyed by report date.
- A registry swap in `lib/askedgar.ts` mirroring the Sprint 1 pattern.
- Test coverage for the concept-picking logic (some filers report only one of the two concepts; some report both with different lineages).

Open questions before scoping: (1) do we need to handle dual-class issuers that report multiple share classes separately? (2) what's the right cache TTL for companyfacts — the file refreshes whenever the company files, so a 24h refresh is probably overkill?

After Sprint 2, the planned 8-K parsing trio (`offerings`, `reverse-splits`, `split-status`) reuses the EDGAR client and starts wiring the buildout doc's "first-wave candidates" checklist (`docs/ae-buildout.md:58`).
