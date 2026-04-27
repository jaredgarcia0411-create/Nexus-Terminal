# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-27
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Recent ships: Agent Hardening #1 (`7118598`), #2 (`2a856f1`), #3 (`bf13567`); Research agent report refinements (`9a69655`, 2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) across `4757fa3`/`0e41b5a`/`8dd6b12`/`fe97e8c`/`c300153` (2026-04-19→20); Tighten Trading Journal UI (`f1fde41`, 2026-04-20); Spend Enforcement Fix across `7aad160`/`abdefe9`/`1bd5e1e`/`8ad674e`/`9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix (`0e96e16`, 2026-04-22); Research Chart History Polish (`5fc5b9e`, 2026-04-22); System Sheet Sync (`63c3a3b` + `a694797`, 2026-04-23); AskEdgar Gap-Stats Mapper Fix (`aa3ea65`, 2026-04-24); AskEdgar Conditional Fan-Out + Cost Telemetry (`29a3920`, 2026-04-27); SEC EDGAR Foundations + Filing-Titles Replacement (`b4a3e73` + `2fb02ab`, 2026-04-27); AskEdgar Sprint 2 — `historical-float-pro` from XBRL companyfacts (`cbde6ee`, 2026-04-27, migration `0024_acoustic_jocasta.sql` applied to Neon).

## Current State

**No active execution spec.** Sprint 2 (`historical-float-pro` → SEC XBRL companyfacts) shipped in `cbde6ee`. Migration `0024_acoustic_jocasta.sql` applied via `npm run db:migrate`. New module `lib/sec/companyfacts.ts` owns the endpoint with 24h DB cache + stale-on-fail fallback; blueprint normalizers fall back to `outstanding` since `float`/`tradableFloat` pass through as null.

## Next Up — AskEdgar Sprint 3 (8-K parsing trio)

Per the buildout doc's first-wave checklist (`docs/ae-buildout.md:58`), the next endpoints to replace are `reverse-splits`, `split-status`, and basic `offerings`. All three share the same input shape: parse 8-K (and adjacent forms like S-1/424) text/exhibits from the SEC EDGAR client we already built in Sprint 1.

Recommended sequencing for Sprint 3:
1. **`reverse-splits` first** — narrowest extraction scope (ratio + effective date), establishes the 8-K parsing pattern. Item 5.03 + 8.01 of 8-K, plus DEF 14A vote results.
2. **`split-status`** as a lifecycle state machine reusing the same parser (pending vote → vote approved → effective → completed).
3. **Basic `offerings`** last — broader (424B variants, 8-K Item 1.01, S-1), but follows the same pattern.

Pre-Sprint-3 prep: confirm the `lib/sec/submissions.ts` filing feed surfaces 8-K accession numbers and primary doc URLs cleanly so the parser can fetch raw filing HTML. Decide whether to store extracted events in a new `sec_split_events` table (per `docs/ae-buildout.md:176`) or keep them inside the existing `secCompanyfactsCache`-style raw cache pattern with a parser-version key.

## Validation Snapshot

Most recent validation (`2026-04-27`, AskEdgar Sprint 2 ship + migration apply):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — 458/458 passed in isolation (one pre-existing flaky timing assertion in `sec-client.test.ts` under full-suite load — unrelated to Sprint 2)
- `npm run db:migrate` — applied `0024_acoustic_jocasta.sql` to Neon

## Follow-Up Notes

- **Financial commentary missing in agent output (logged 2026-04-27).** GLND research report from a Sprint 1 smoke run claimed "no financial commentary available," which is almost never true for a real ticker. Desired behavior: agents should surface the source commentary **verbatim** in the report, then add their own analysis on top — not replace the source text with a summary. Investigate which AskEdgar/SEC field feeds the "financial commentary" section and why the agent suppressed it. Likely candidates: `dilution-data` notes, MD&A sections from 10-Q/10-K, or the `news` endpoint's commentary field. Track separately from Sprint 3.
- **AskEdgar paid API key swapped (2026-04-27).** Test key expired. `https://eapi.askedgar.io` remains the correct base URL — the readme.io docs list `https://api.askedgar.com`, which redirects to a HugeDomains parking page. Only swap the `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles` and Sprint 2 dropped `historical-float-pro` from the AskEdgar fan-out. Daily spend at ~10 unique tickers/day should now sit well below the post-trim ~$5–$10/day estimate. Measure with the `[askedgar-fanout]` log's `costUsd` token over the next few report runs.
- **News-formatter UX trade.** Filing feeds default to `${formType} filing` labels (e.g. "8-K filing") via the existing fallback in `lib/agents/news-formatter.ts:198`. AI headlines are deferred to buildout-doc Phase 8 (`docs/ae-buildout.md:396`).
- **Sprint 2 smoke checklist (post-deploy).** First production request on a real ticker should log `[sec-companyfacts] loaded N entries from SEC for {ticker}` (cold). Subsequent request within 24h: `[sec-companyfacts] hydrated N entries from db for {ticker}` (warm). Bad ticker (`ZZZZZ`): `[sec-companyfacts] no CIK for ticker ZZZZZ` warn fires; report still completes empty.
