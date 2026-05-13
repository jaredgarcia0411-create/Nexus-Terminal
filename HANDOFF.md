# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-13
> Purpose: active execution spec for SEC filing expansion. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

## Current Context

- Cleanup roadmap Steps 1-6 are complete. Step 7 remains intentionally parked except for the AskEdgar split included in the active spec below.
- Recent shipped work includes Market Pulse v1/v1.1, AskEdgar dilution/scanner recovery, the Day 1 scanner threshold fix, and final Research/scanner UI polish.
- Commit `d545aea` pushed the latest scanner/dilution/Research polish work to `origin/main`.
- Open parked items outside this spec: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, and Backtest Manager `broke_premarket_high`.

## Active Execution Spec

Goal: Implement Nexus-native SEC filing expansion for the Research Filings tab and first-party event extraction for completed offerings, reverse splits, and previous ticker/symbol changes.

Read `HANDOFF.md` first, verify it against the live repo, and preserve existing architecture. This is an implementation goal, but it must be checkpointed. Do not push unless explicitly asked. Commit locally before moving from Phase 1 into Phase 2.

Core objective:
- Pull more SEC filings than the current recent-only path.
- Use those filings to improve completed offering history, reverse split coverage, and previous ticker/symbol change history.
- Keep the Research tab usable and compatible with the current normalized `ResearchSnapshot` shape.
- Add the AskEdgar module split only after the SEC filing expansion contract is clear and locally committed.

Constraints:
- No secrets/env changes.
- No broad cleanup beyond the named AskEdgar split.
- Leave TradingView extraction, generic client cache hook, use-trades, and BacktestChart refactors out of scope.
- Use existing SEC helpers and DB patterns where possible.
- Keep raw SEC source data separate from extracted events and normalized UI snapshots.
- Preserve AskEdgar compatibility while introducing first-party SEC-backed outputs.
- Add focused tests for every new parser/helper and route/normalizer behavior touched.
- Run required validation before each local commit: `npm run lint`, `npx tsc --noEmit`, and relevant tests; run full `npm test` before final handoff. If `HANDOFF.md` or workflow docs change, run `npm run workflow:audit`.

Phase 0 - Repo Review And Contract Confirmation:
1. Inspect current files:
   - `lib/sec/submissions.ts`
   - `lib/sec/filing-body.ts`
   - `lib/sec/offerings.ts`
   - `lib/sec/reverse-splits.ts`
   - `lib/sec/cik-map.ts`
   - `lib/askedgar.ts`
   - `lib/types.ts`
   - `components/trading/ResearchReportSections.tsx`
   - `app/api/askedgar/snapshot/route.ts`
   - relevant tests under `__tests__/`
2. Confirm current blockers:
   - Research Filings tab is populated from normalized AskEdgar `news` filing rows, not a richer SEC metadata feed.
   - `getRecentFilings()` only reads `filings.recent`, defaults to 20 rows / 90 days, and does not follow SEC submissions archive shards.
   - Offerings scan is too narrow.
   - Reverse split scan is too narrow.
   - No previous ticker/symbol change parser or contract exists.
3. If the live repo differs materially, update the plan before editing.

Phase 1 - SEC Filing Expansion Contract And Foundation:
Implement the SEC filing metadata expansion first.

Required behavior:
1. Extend SEC submissions support to read both:
   - `filings.recent`
   - older archive shards from `filings.files`
2. Dedupe filings by accession number.
3. Preserve richer filing metadata:
   - CIK
   - ticker requested / ticker at ingest if available
   - accession number
   - form type
   - filed date
   - report date if present
   - acceptance datetime if present
   - SEC items
   - primary document
   - primary document description
   - SEC URL
   - archive source if from a shard
4. Add/prepare a durable raw metadata storage layer if needed, following existing Drizzle conventions. Use a table shape aligned with the roadmap concept of `sec_filings_raw`.
5. Add a contract/helper that supports distinct pull profiles:
   - Research Filings tab: up to 300 newest filings or 24 months, whichever is smaller; metadata only by default.
   - Completed offerings: 10 years metadata; parse up to 300 candidate filing bodies.
   - Reverse splits: 10 years metadata; parse up to 200 candidate filing bodies.
   - Symbol/name changes: 10 years metadata; parse up to 200 candidate filing bodies.
6. Keep body fetching lazy and candidate-based. Do not fetch every filing body for the Research Filings tab.

Phase 1 UI/data integration:
1. Feed the Research Filings tab from the expanded first-party SEC filing metadata path.
2. Keep current buckets working.
3. Add any new fields to `ResearchSnapshotFiling` only if needed and keep them client-safe.
4. Preserve existing AskEdgar `news` handling for actual news rows.

Phase 1 validation and checkpoint:
1. Add/update tests for submissions archive shard hydration, dedupe, limits, metadata preservation, and Research snapshot mapping.
2. Run:
   - targeted tests for SEC submissions / snapshot mapper / filings bucket
   - `npm run lint`
   - `npx tsc --noEmit`
   - relevant route/component tests
3. Update `HANDOFF.md` with Phase 1 status and validation evidence.
4. Commit locally with a clear message, for example:
   `Expand SEC filing metadata contract`
5. Stop and confirm the local commit exists before beginning Phase 2. Do not push.

Phase 1 checkpoint status (2026-05-13):
- Implemented expanded SEC submissions metadata support in `lib/sec/submissions.ts`: `filings.recent` plus archive shard hydration from `filings.files`, accession-number dedupe, richer metadata preservation, lazy profile contracts, and Research/offering/reverse-split pull profiles.
- Added durable raw SEC metadata storage shape `sec_filings_raw` in `lib/db/schema.ts` with migration `drizzle/0035_red_ken_ellis.sql`; body text remains in the existing lazy `sec_filing_body_cache`.
- Wired Research Filings to first-party SEC metadata through the SEC-backed `sec-filings` endpoint while preserving AskEdgar `news` for actual news rows and retaining news-row filing fallback when SEC metadata is absent.
- Updated completed-offering and reverse-split callers to use the expanded 10-year metadata profiles while still fetching bodies only for filtered candidate filings.
- Validation completed before checkpoint commit:
  - `npx vitest run __tests__/sec-submissions.test.ts __tests__/research-snapshot-mapper.test.ts __tests__/askedgar-client.test.ts __tests__/sec-offerings.test.ts __tests__/sec-reverse-splits.test.ts` passed: 5 files, 41 tests.
  - `npm run lint` passed.
  - `npx tsc --noEmit` passed.
  - `npm test` passed: 87 files, 630 tests.
- Phase 2 AskEdgar module split has not started. Stop here after the local Phase 1 commit unless the user explicitly reopens Phase 2.

Phase 2 - AskEdgar Module Split:
Only after Phase 1 is locally committed, split the AskEdgar module enough to support the new SEC-backed architecture.

Scope:
- Split `lib/askedgar.ts` into focused modules such as:
  - `lib/askedgar/endpoints.ts`
  - `lib/askedgar/fanout.ts`
  - `lib/askedgar/cache.ts`
  - `lib/askedgar/snapshot-normalizer.ts`
  - keep a compatibility barrel/export if needed so imports do not churn excessively.
- Do not change behavior during this phase except where required to preserve existing tests.
- Keep endpoint registry, scope-aware fanout, cache merge semantics, scanner-summary cache, and snapshot normalization behavior equivalent.
- Add or update tests only where import paths/contracts change.

Phase 2 validation and checkpoint:
1. Run focused AskEdgar tests.
2. Run:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
3. Update `HANDOFF.md`.
4. Commit locally with a clear message, for example:
   `Split AskEdgar data pipeline modules`
5. Do not push.

Phase 2 checkpoint status (2026-05-13):
- Split the monolithic AskEdgar client into focused modules while preserving the compatibility barrel at `lib/askedgar.ts`:
  - `lib/askedgar/types.ts`
  - `lib/askedgar/runtime-state.ts`
  - `lib/askedgar/endpoints.ts`
  - `lib/askedgar/fanout.ts`
  - `lib/askedgar/cache.ts`
  - `lib/askedgar/snapshot-normalizer.ts`
- Preserved existing import compatibility for callers that use `@/lib/askedgar`; no downstream import churn was required.
- Kept endpoint registry, scope-aware fanout, cache merge semantics, scanner-summary cache, rate-limit/daily-ticker state, and snapshot normalization behavior equivalent.
- Validation completed before checkpoint commit:
  - `npx vitest run __tests__/askedgar-client.test.ts __tests__/research-snapshot-mapper.test.ts __tests__/askedgar-snapshot-route.test.ts __tests__/askedgar-tldr-route.test.ts __tests__/scanner-summary-route.test.ts` passed: 5 files, 37 tests.
  - `npm run lint` passed.
  - `npx tsc --noEmit` passed.
  - `npm test` passed: 87 files, 630 tests.
  - `npm run workflow:audit` passed.
- Phase 3 completed-offerings expansion has not started. Stop here after the local Phase 2 commit unless the user explicitly reopens Phase 3.

Phase 3 - Completed Offerings Expansion:
Improve first-party completed offering extraction.

Candidate forms:
- `424B*`
- `FWP`
- `EFFECT`
- `S-1`, `S-1/A`
- `S-3`, `S-3/A`
- `F-1`, `F-1/A`
- `F-3`, `F-3/A`
- `8-K`, `8-K/A` with Items `1.01`, `2.03`, `3.02`, `7.01`, `8.01`, `9.01`

Extract and store/return:
- status: `announced`, `priced`, `closed`, `terminated`, `resale_only`, or `unknown`
- offering type
- filed date
- closed/priced date if present
- gross proceeds
- net proceeds if present
- shares/securities amount
- price per share/unit
- warrants if present
- resale-only flag
- source accession and URL
- confidence/source text snippet if practical

Important:
- Prefer precision over overcounting.
- Completed/closed offerings should be distinguishable from mere registrations/resale prospectuses.
- Keep existing `ResearchSnapshotOffering` compatibility or add a richer internal event shape and map down for UI.

Phase 3 checkpoint status (2026-05-13):
- Broadened completed-offering candidate discovery in `lib/sec/offerings.ts` to include `424B*`, `FWP`, `EFFECT`, `S-1`, `S-1/A`, `S-3`, `S-3/A`, `F-1`, `F-1/A`, `F-3`, `F-3/A`, and `8-K` / `8-K/A` Items `1.01`, `2.03`, `3.02`, `7.01`, `8.01`, and `9.01`.
- Kept body fetching lazy and candidate-based through the completed-offerings SEC pull profile; non-candidate forms such as `10-Q` are not fetched for offering bodies.
- Expanded `lib/sec/offerings-extractors.ts` to return richer raw offering event fields: status (`announced`, `priced`, `closed`, `terminated`, `resale_only`, `unknown`), securities amount, net proceeds, priced/closed dates when present, source snippets, and confidence.
- Preserved `ResearchSnapshotOffering` compatibility in the snapshot normalizer while filtering `resale_only` raw offering events from the UI-facing past-offerings list.
- Validation completed before checkpoint commit:
  - `npx vitest run __tests__/sec-offerings-parser.test.ts __tests__/sec-offerings.test.ts __tests__/research-snapshot-mapper.test.ts` passed: 3 files, 29 tests.
  - `npm run lint` passed.
  - `npx tsc --noEmit` passed.
  - `npm test` passed: 87 files, 634 tests.
  - `npm run workflow:audit` passed.
- Phase 4 reverse-split expansion has not started. Stop here after the local Phase 3 commit unless the user explicitly reopens Phase 4.

Phase 4 - Reverse Split Expansion:
Improve reverse split coverage.

Candidate forms:
- `8-K`, `8-K/A` with Items `5.03`, `8.01`
- `6-K`
- `DEF 14A`, `PRE 14A`, `DEF 14C`, `PRE 14C`
- related proxy amendments where applicable

Extract:
- lifecycle status: proposed, approved, announced, effective/completed
- ratio
- announcement date
- effective date
- vote/approval date if present
- source accession and URL
- confidence/source snippet if practical

Keep existing parser behavior but broaden candidate discovery.

Phase 5 - Previous Ticker / Symbol Change Extraction:
Add first-party identity event extraction.

Candidate forms:
- `8-K`, `8-K/A` with Items `5.03`, `8.01`
- `6-K`
- proxy forms
- registration cover pages where they disclose former names/symbols

Parse for:
- previous ticker
- new/current ticker
- previous company name
- new/current company name
- effective date
- exchange/market if present
- source accession and URL
- event type: ticker change, name change, CIK identity continuity, exchange/listing change if obvious

Add a normalized UI-safe contract, likely:
- `ResearchSnapshotIdentityEvent[]`
or similar, and decide where it should display in Research. If UI placement is not obvious, add the normalized data and document the recommended placement rather than forcing a large UI redesign.

Phase 6 - Final Integration And Validation:
1. Ensure Research Filings tab now shows a broader first-party SEC filing set.
2. Ensure completed offerings use the broader metadata/body candidate pipeline.
3. Ensure reverse splits use the broader metadata/body candidate pipeline.
4. Ensure previous ticker/symbol changes are parsed and exposed in a normalized contract.
5. Add tests for:
   - archive shard metadata ingestion
   - candidate filtering counts/limits
   - completed offering status extraction
   - reverse split broadened forms
   - symbol/name change parser
   - snapshot normalization
6. Run:
   - targeted SEC parser tests
   - targeted Research snapshot/UI tests
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run workflow:audit` if docs/handoff changed
7. Update `HANDOFF.md` with shipped behavior, validation evidence, residual risks, and any manual review notes.
8. Create a final local commit. Do not push unless explicitly instructed.

Completion criteria:
- A ticker can retrieve substantially more SEC filing metadata than the old 20-row/90-day recent-only path.
- Research Filings tab is backed by the expanded SEC metadata feed.
- Completed offering parser can identify more actual completed/closed financings and distinguish them from registrations/resale-only filings.
- Reverse split parser covers more than only 8-K Item 5.03.
- Previous ticker/symbol/name changes are parsed into a first-party normalized contract.
- AskEdgar split is completed after Phase 1 and does not change behavior by itself.
- Each checkpoint has a local commit before moving on.
- Final working tree status and validation results are reported clearly.
