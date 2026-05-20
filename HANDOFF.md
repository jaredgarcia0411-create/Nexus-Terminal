# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-19
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

---

## Spec: Broaden offerings extractors for ADS / ordinary shares / per-ADS pricing

> Generated: 2026-05-19 | Author: inline (post-investigation)
> Status: COMPLETED 2026-05-19
> Owner: Codex

Completion evidence:
- Implemented Changes 1-5 in order, plus a focused normalizer regression assertion for the `securitiesAmount` fallback.
- Tightened the live implementation to `row.sharesAmount ?? row.securitiesAmount ?? null` so older/raw offering rows that omit `securitiesAmount` still preserve the snapshot contract.
- Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run workflow:audit`.
- Manual browser smoke was not run in this session.

Follow-up (open): Smoke check on a fresh ticker.
- 2026-05-19 attempt: WNW Past Offerings table still rendered identically post-deploy because the snapshot was cached. Verify on a ticker whose snapshot hasn't been built yet (any ADS/FPI name — e.g. RUBI, or another fresh CN ADR). Confirm Shares / Price / Amount columns populate for at least one priced row; if all "--", capture the filing URL and open a follow-up spec.
- Also worth re-checking on WNW once its cache TTL expires (per `lib/askedgar/cache-config.ts` defaults).

The Past Offerings table on the Research tab shows correct dates and types for foreign issuers (e.g. WNW, a Chinese ADS issuer) but every numeric column is "--". Root cause: `lib/sec/offerings-extractors.ts` only recognizes US-domestic equity language ("shares of common stock", "per share", "gross proceeds"). Foreign issuers and dual-class US issuers use different terminology, so the extractors silently return `null` for every numeric field even when the filing contains the data.

This spec broadens three extractor regexes (share count, per-share price, offering amount) to also match ADS / ordinary shares / Class A/B common / capital stock language, adds three test cases covering the new variants, and adds a one-line normalizer fallback so the UI's "Shares" column shows `securitiesAmount` when `sharesAmount` is null (e.g. units offerings). Row filtering and classification are unchanged.

### Background context Codex must know first

- `lib/sec/offerings-extractors.ts` is a pure-text parser run against the body of SEC filings already fetched by `getOfferings(rawTicker)` in `lib/sec/offerings.ts`. Output flows through `lib/askedgar/snapshot-normalizer.ts` → `data.offerings` → `PastOfferingsTable` in `components/trading/ResearchReportSections.tsx:655`.
- The UI table reads `row.sharesAmount`, `row.sharePrice`, `row.offeringAmount` directly. Today the normalizer maps `row.sharesAmount` straight through (see `lib/askedgar/snapshot-normalizer.ts:268`), so when only `securitiesAmount` is extracted (units / pre-funded warrants), the column shows "--". Change 5 adds a fallback.
- `looksLikeAuthorizedShareContext` (offerings-extractors.ts:125-130) guards against accidentally matching "authorized to issue X shares" language. It uses a generic "authorized" anchor that already works for any equity term, so it does not need to change.
- Existing tests live in `__tests__/sec-offerings-parser.test.ts` and `__tests__/sec-offerings.test.ts`. They use "shares of common stock" fixtures and should remain green after this change.

---

### Change 1 — Broaden `extractShareCount` to match ADS / ordinary shares / Class A-B common / capital stock

**File:** `lib/sec/offerings-extractors.ts`
**Action:** MODIFY

1. Locate `extractShareCount` (currently lines 185-203). Replace the two regex declarations at the top of the function.

   **Replace exactly this block:**
   ```ts
   export function extractShareCount(text: string): number | null {
     const anchorPattern = /shares?\s+of\s+(?:our\s+)?common\s+stock/gi;
     const sharePattern = /([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+shares?\s+of\s+(?:our\s+)?common\s+stock/i;
   ```

   **With:**
   ```ts
   export function extractShareCount(text: string): number | null {
     // Equity-term group. Order matters within alternation: longer "shares of <X>
     // (common|capital|Class A/B common) stock" phrases come first so they win
     // over a bare "ordinary shares" fallback. Foreign issuers (e.g. CN ADRs)
     // file in "ordinary shares" / "ADSs" terminology; dual-class US issuers
     // use "Class A/B common stock"; some filers use "capital stock".
     const anchorPattern = /(?:shares?\s+of\s+(?:our\s+)?(?:Class\s+[AB]\s+common|common|capital)\s+stock|ordinary\s+shares|American\s+Depositary\s+Shares|ADSs?)/gi;
     const sharePattern = /([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+(?:shares?\s+of\s+(?:our\s+)?(?:Class\s+[AB]\s+common|common|capital)\s+stock|ordinary\s+shares|American\s+Depositary\s+Shares|ADSs?)/i;
   ```

   The rest of the function body (the for-loop, `findMatchCrossingAnchor`, `looksLikeAuthorizedShareContext`, `parseScaledNumber`) is unchanged.

2. Confirm no other usage of those two regex literals exists in the file. Grep `lib/sec/offerings-extractors.ts` for `shares\s+of\s+(?:our\s+)?common\s+stock` and expect zero hits after the edit.

**Expected behavior after Change 1:**
- "5,000,000 ordinary shares" → `extractShareCount` returns `5_000_000`.
- "10 million American Depositary Shares" → returns `10_000_000`.
- "2,500,000 ADSs" → returns `2_500_000`.
- "3,000,000 shares of Class A common stock" → returns `3_000_000`.
- "1,000,000 shares of capital stock" → returns `1_000_000`.
- "5,000,000 shares of our common stock" (existing fixture) → still returns `5_000_000`.
- "We are authorized to issue 200,000,000 ordinary shares … 5,000,000 ordinary shares" → still returns `5_000_000` (authorized-context guard fires for the first match, walks past it).

---

### Change 2 — Broaden `extractPricePerShare` to match per-ADS / per-ordinary-share / per-Class-A-share

**File:** `lib/sec/offerings-extractors.ts`
**Action:** MODIFY

1. Locate `extractPricePerShare` (currently lines 225-231).

   **Replace exactly this block:**
   ```ts
   export function extractPricePerShare(text: string): number | null {
     const match = /\$\s*([\d,.]+)\s+per\s+(?:share|unit|pre-funded\s+warrant|security)/i.exec(text);
     if (!match?.[1]) return null;
   ```

   **With:**
   ```ts
   export function extractPricePerShare(text: string): number | null {
     // Per-unit price terms. ADS-issuing foreign filers quote "$X per ADS";
     // dual-class issuers quote "per Class A (common) share"; the original
     // (share|unit|pre-funded warrant|security) covers domestic single-class.
     const match = /\$\s*([\d,.]+)\s+per\s+(?:share|unit|pre-funded\s+warrant|security|ADS|ordinary\s+share|Class\s+[AB]\s+(?:common\s+)?share)/i.exec(text);
     if (!match?.[1]) return null;
   ```

   The rest of the function (the parseFloat / Number.isFinite check) is unchanged.

**Expected behavior after Change 2:**
- "$1.52 per ADS" → returns `1.52`.
- "$0.80 per ordinary share" → returns `0.80`.
- "$2.50 per Class A common share" → returns `2.50`.
- "$2.50 per Class B share" → returns `2.50`.
- "$2.50 per share" (existing fixture) → still returns `2.50`.

---

### Change 3 — Extend the offering-amount anchor list

**File:** `lib/sec/offerings-extractors.ts`
**Action:** MODIFY

1. Locate the `offeringAmount` extraction call inside `extractOfferingFieldsFromSection` (currently lines 335-339).

   **Replace exactly this block:**
   ```ts
     const offeringAmount = extractDollarAmount(section, [
       /gross\s+proceeds/i,
       /aggregate\s+gross\s+proceeds/i,
       /aggregate\s+offering\s+price/i,
     ]);
   ```

   **With:**
   ```ts
     const offeringAmount = extractDollarAmount(section, [
       /gross\s+proceeds/i,
       /aggregate\s+gross\s+proceeds/i,
       /aggregate\s+offering\s+price/i,
       /total\s+proceeds/i,
       /aggregate\s+proceeds/i,
       /(?:total|aggregate)\s+purchase\s+price/i,
       /proceeds\s+(?:to\s+(?:the\s+)?(?:company|issuer)|from\s+the\s+offering)/i,
     ]);
   ```

   `netProceedsAmount` directly below it (`net\s+proceeds`, `estimated\s+net\s+proceeds`) stays unchanged — ADS filings still use the "net proceeds" phrasing.

**Expected behavior after Change 3:**
- "for total proceeds of approximately $5 million" → `offeringAmount = 5_000_000`.
- "aggregate purchase price of $3.2 million" → `offeringAmount = 3_200_000`.
- "proceeds to the company of $4.0 million" → `offeringAmount = 4_000_000`.
- "gross proceeds of $5.0 million" (existing fixture) → still `5_000_000`.

---

### Change 4 — Add test coverage for ADS / ordinary / Class A variants

**File:** `__tests__/sec-offerings-parser.test.ts`
**Action:** MODIFY

1. Append the following three test cases inside the `describe('SEC offerings extractors', () => { ... })` block, immediately before the closing `});` on the final line (currently line 265). Insert in this order:

   ```ts
     it('extracts ADS-denominated 424B5 fields for foreign issuers', () => {
       const body = [
         'THE OFFERING',
         'We are offering 10,000,000 American Depositary Shares ("ADSs").',
         'The purchase price is $1.52 per ADS.',
         'We expect total proceeds of approximately $15.2 million.',
       ].join(' ');

       expect(extractOfferingFrom424B(body, '424B5')).toEqual(expect.objectContaining({
         status: 'priced',
         sharesAmount: 10_000_000,
         securitiesAmount: 10_000_000,
         sharePrice: 1.52,
         offeringAmount: 15_200_000,
         isSellingStockholderResale: false,
       }));
     });

     it('extracts ordinary-shares offerings without "of common stock" anchor', () => {
       const body = [
         'PROSPECTUS SUPPLEMENT SUMMARY',
         'We are offering 8,000,000 ordinary shares.',
         'The purchase price is $0.80 per ordinary share.',
         'Aggregate purchase price of $6.4 million.',
       ].join(' ');

       expect(extractOfferingFrom424B(body, '424B5')).toEqual(expect.objectContaining({
         status: 'priced',
         sharesAmount: 8_000_000,
         sharePrice: 0.8,
         offeringAmount: 6_400_000,
       }));
     });

     it('extracts dual-class Class A common share fields', () => {
       const body = [
         'THE OFFERING',
         'We are offering 4,000,000 shares of Class A common stock.',
         'The purchase price is $2.50 per Class A common share.',
         'Gross proceeds of $10 million.',
       ].join(' ');

       expect(extractOfferingFrom424B(body, '424B3')).toEqual(expect.objectContaining({
         status: 'priced',
         sharesAmount: 4_000_000,
         sharePrice: 2.5,
         offeringAmount: 10_000_000,
       }));
     });
   ```

2. Leave all existing tests untouched. They use "shares of common stock" / "per share" / "gross proceeds" fixtures and must continue passing — this is the regression guard for the broadened regexes.

**Expected behavior after Change 4:**
- `npx vitest run __tests__/sec-offerings-parser.test.ts` reports all existing tests pass + 3 new tests pass.

---

### Change 5 — Normalizer falls back from `sharesAmount` to `securitiesAmount`

**File:** `lib/askedgar/snapshot-normalizer.ts`
**Action:** MODIFY

1. Locate the offerings mapping block (currently lines 260-275 in the `normalizeAskEdgarResponse` function).

   **Replace exactly this block:**
   ```ts
         .map((row) => {
           return {
             headline: buildOfferingHeadline(row),
             filedAt: row.filedAt,
             offeringType: row.offeringType,
             sharesAmount: row.sharesAmount,
             warrantsAmount: row.warrantsAmount,
             sharePrice: row.sharePrice,
             offeringAmount: row.offeringAmount,
           } satisfies ResearchSnapshotOffering;
         })
   ```

   **With:**
   ```ts
         .map((row) => {
           return {
             headline: buildOfferingHeadline(row),
             filedAt: row.filedAt,
             offeringType: row.offeringType,
             // Fall back to securitiesAmount (units / pre-funded warrants /
             // generic "securities") when the more specific shares anchor
             // didn't fire. The UI's "Shares" column would otherwise show "--"
             // even though the extractor captured a value. The headline
             // intentionally still uses row.sharesAmount only, so we don't
             // claim "X shares" in the headline when only securitiesAmount
             // was extracted.
             sharesAmount: row.sharesAmount ?? row.securitiesAmount ?? null,
             warrantsAmount: row.warrantsAmount,
             sharePrice: row.sharePrice,
             offeringAmount: row.offeringAmount,
           } satisfies ResearchSnapshotOffering;
         })
   ```

   The surrounding `dedupeByHeadline` wrapper, `.filter(...)` calls, and `buildOfferingHeadline(row)` argument are unchanged.

**Expected behavior after Change 5:**
- Units offering ("100,000 units, each consisting of one share + one warrant") → `sharesAmount = null`, `securitiesAmount = 100_000` → table shows `100,000` in the Shares column.
- Foreign issuer where Change 1's broadened anchor fires → both `sharesAmount` and `securitiesAmount` are set → fallback no-op, no change vs. Change 1 alone.
- Existing rows where `sharesAmount` was already populated → no change.

---

### Files Changed Summary

| File | Change | Risk |
|------|--------|------|
| `lib/sec/offerings-extractors.ts` | Broaden 3 regexes (share count anchor + pattern, per-share price, offering-amount anchors); add explanatory comments | Medium (regex changes can over-match; tests are the guardrail) |
| `__tests__/sec-offerings-parser.test.ts` | Add 3 new test cases for ADS / ordinary shares / Class A common variants | Trivial |
| `lib/askedgar/snapshot-normalizer.ts` | Fallback: `sharesAmount: row.sharesAmount ?? row.securitiesAmount ?? null` | Low (only affects rows that previously showed "--" in the Shares column) |
| `__tests__/research-snapshot-mapper.test.ts` | Assert the fallback maps `securitiesAmount` into the snapshot `sharesAmount` field | Trivial |

Estimated total: 4 files touched, ~70 lines added, ~6 lines removed.

---

### Verification Steps

Run in order from repo root after all five changes are implemented:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test` (all 96+ test files should pass; specifically watch `sec-offerings-parser.test.ts`, `sec-offerings.test.ts`, and `research-snapshot-mapper.test.ts` for any assertions on `sharesAmount`)

Manual smoke checks (run `npm run dev`):

- **Foreign issuer (ADS):** open Research → search ticker **WNW**. Past Offerings table should now show non-empty Shares / Price / Amount cells for the 1/26/2026 PUBLIC OFFERING row at minimum. (Shelf takedowns with no price disclosure in the filing body will still show "--" — that's expected.)
- **Domestic single-class regression check:** open Research for any US small-cap (e.g. **AMC**, **GME**, or any ticker you've recently viewed). Past Offerings should look identical to before — same shares/price/amount values for known rows. If any previously populated row now shows "--", the regex broadening over-shot and needs to be tightened.
- **Dual-class:** open Research for **GOOG** or **META** if available in the watchlist. Confirm Past Offerings still renders correctly (these companies rarely have recent offerings, but the table shouldn't error).

If the manual ADS check still shows all "--" for a known-priced WNW row, capture the filing URL from the row's link, fetch its body, and inspect what phrasing the filing actually uses for shares/price/amount — the regex may need a fourth iteration to match a phrasing variant not covered here.

---

### Open Questions

None — the normalizer fallback (previously deferred) is now bundled in as Change 5. If after shipping, the Research page still shows "--" for known-priced rows on a specific ticker, capture the filing URL from the row's SEC link, inspect the filing body, and open a follow-up spec for whichever phrasing variant the current regexes don't cover.

---

## Session Maintenance Checklist

- [x] Read this file before starting.
- [x] If the active context drifts from the live repo, update the context or stop and ask before editing.
- [x] Implement Changes 1–5 in the order listed above. One commit covering all five is fine since they're tightly coupled (regex broadening + matching test fixtures + the dependent normalizer fallback).
- [x] Run the Verification Steps before reporting work complete.
- [ ] Do not push to remote without explicit user instruction.
- [x] Do not modify `.env*` or secret files.
- [x] Use `npm run db:migrate`, never `db:push` (not applicable to this spec, but the standing rule still applies).
