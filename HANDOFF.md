# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-29
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Recent ships: Backtesting Tab full rollout (`6456f69`). Filings v1 (`9d31489`). AskEdgar Sprint 3 Part A (`003aa8c`, reverse-splits via SEC 8-K Item 5.03 parser). AskEdgar Sprints 1 + 2 (`filing-titles`, `historical-float-pro`) live. Sprint 3 owns the SEC body-fetch + cache infrastructure (`lib/sec/filing-body.ts`, `secFilingBodyCache`). Sprint 3 Part B (`split-status`) was researched and parked pending endpoint-usage audit — see auto-memory `project_split_status_research.md`.

## Active Specs

### Sprint 4 — Basic offerings SEC parser + remove `pump-and-dump-tracker`

> Generated: 2026-04-29 | Author: Claude (inline plan from /handoff)
> Status: PLANNED
> Goal: Replace AskEdgar's per-ticker `/v1/offerings` with a SEC-derived parser that extracts offering events from 424B prospectus supplements + 8-K Item 3.02 + 8-K Item 1.01, projected into the existing `ResearchSnapshotOffering[]` contract. In the same sprint, remove `pump-and-dump-tracker` from the fan-out (no replacement). **Screener removal is deferred** — it feeds 9 header fields and removing it without a replacement breaks the Research card.

#### Background and decisions (already settled)

- **Form universe**: `424B1`, `424B2`, `424B3`, `424B4`, `424B5`, `424B7` + 8-K (and 8-K/A) with `items` containing `3.02` (PIPE/unregistered) or `1.01` (material agreement / SPA). Use `^424B[1-7]$` regex for inclusivity.
- **Scan window**: 24 months (`sinceDays: 730`), `limit: 50` filings.
- **Section locator**: 424B bodies are 80K–300K chars stripped. Find anchor `THE OFFERING` / `PROSPECTUS SUPPLEMENT SUMMARY` / `SUMMARY OF THE OFFERING` / `OFFERING TERMS` and parse a ±10K char window around it. If no anchor, fall back to scanning the first 60K chars. If still no match, return `null` (not an error — usually a resale or technical amendment).
- **Resale detection**: search the first 5K chars of the body for the literal phrase `selling stockholders`. Set `isSellingStockholderResale: true` when found. **Do not drop the row at the parser level** — filtering happens in the snapshot projection layer (Phase 3). Agents may opt to see resales in the future.
- **Missing fields → `null`**, never drop the row. A row with only `headline` and `filedAt` is still useful.
- **Dedup strategy**: one row per filing. Existing `dedupeByHeadline()` in the projection layer handles obvious duplicates.
- **`OfferingType` union**: REGISTERED OFFERING, ATM USED, PRIVATE PLACEMENT, PIPE, REGISTERED DIRECT, PUBLIC OFFERING, SHELF TAKEDOWN, BEST EFFORTS, IPO, plus `null`. AE's DEBT OFFERING / DEBT CONVERSION / CREDIT FACILITY / SHARE ISSUANCE FOR ACQUISITION / UPLIST are intentionally excluded — no reliable extraction path in v1, blueprints don't filter on type.
- **Headline format**: when fields extracted: `"<Type> — <shares> shares @ $<price> — $<amount>"` (e.g. `"Registered Direct — 5,000,000 shares @ $2.50 — $12.5M"`). Fallback when fields are null: `"Offering (<formType>)"` (e.g. `"Offering (424B5)"`, `"PIPE (8-K Item 3.02)"`).
- **Cache**: reuse `secFilingBodyCache` (no schema change). Add `'offerings'` to `SEC_BACKED_ENDPOINT_KEYS` in `lib/askedgar.ts`.
- **Pump-and-dump removal scope**: remove the fetch function, registry entry, scope membership, normalizer references, and small-cap-research blueprint references. `overallRisk` field on the snapshot becomes always-`null` (acceptable; it was a single field). `regsho` keeps reading from `compliance` (the `pumpAndDump` fallback is dropped).

---

#### Phase 1 — Extractors + unit tests

**File:** `lib/sec/offerings-extractors.ts`
**Action:** CREATE

1. Add module-level constants at the top of the file:
   ```ts
   const OFFERING_ANCHORS_424B = [
     'THE OFFERING',
     'PROSPECTUS SUPPLEMENT SUMMARY',
     'SUMMARY OF THE OFFERING',
     'OFFERING TERMS',
   ] as const;

   const ANCHOR_WINDOW_CHARS = 10_000;
   const FALLBACK_SCAN_CHARS = 60_000;
   const RESALE_DETECTION_CHARS = 5_000;
   const FIELD_CONTEXT_CHARS = 300;
   ```

2. Export `OfferingType` union and `RawOffering` interface (matches what `getOfferings` will return per row):
   ```ts
   export type OfferingType =
     | 'REGISTERED OFFERING'
     | 'ATM USED'
     | 'PRIVATE PLACEMENT'
     | 'PIPE'
     | 'REGISTERED DIRECT'
     | 'PUBLIC OFFERING'
     | 'SHELF TAKEDOWN'
     | 'BEST EFFORTS'
     | 'IPO'
     | null;

   export interface RawOffering {
     accessionNumber: string;
     formType: string;
     filedAt: string;            // YYYY-MM-DD
     url: string;
     offeringType: OfferingType;
     sharesAmount: number | null;
     sharePrice: number | null;
     offeringAmount: number | null;
     warrantsAmount: number | null;
     isSellingStockholderResale: boolean;
   }

   export interface ExtractedOfferingFields {
     offeringType: OfferingType;
     sharesAmount: number | null;
     sharePrice: number | null;
     offeringAmount: number | null;
     warrantsAmount: number | null;
     isSellingStockholderResale: boolean;
   }
   ```

3. Implement `findOfferingSection(text: string): string | null` — uppercase-search the body for any of `OFFERING_ANCHORS_424B`. On hit, slice `[idx, idx + ANCHOR_WINDOW_CHARS]` from the original (case-preserving) text and return it. On miss, return the first `FALLBACK_SCAN_CHARS` of text. Return `null` only when text is empty.

4. Implement `detectSellingStockholderResale(text: string): boolean` — case-insensitive search for the phrase `selling stockholders` within the first `RESALE_DETECTION_CHARS` characters. Return true on hit.

5. Implement `extractDollarAmount(text: string, anchorPatterns: RegExp[]): number | null`:
   - For each anchor pattern, `.exec(text)`; if no match, continue.
   - Slice a `±FIELD_CONTEXT_CHARS` window around the anchor match.
   - Run `/\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion)?/i` against the window.
   - Strip commas, parse float, multiply by `1_000_000` (million) or `1_000_000_000` (billion) if suffix present, otherwise `1`.
   - Return the first valid result; return `null` if no anchor produced one.

6. Implement `extractShareCount(text: string): number | null` using anchor `/shares?\s+of\s+(?:our\s+)?common\s+stock/i`:
   - Find anchor, slice ±FIELD_CONTEXT_CHARS window.
   - Run `/([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+shares?\s+of\s+(?:our\s+)?common\s+stock/i` on the window — note the count regex looks **backwards** from the anchor, so window must include text before the anchor.
   - Apply million (1e6) or thousand (1e3) multiplier; default 1.
   - Skip captures that look like share-class language ("X shares" inside "authorized capital" — see test case in step 11).

7. Implement `extractPricePerShare(text: string): number | null` using regex `/\$\s*([\d,.]+)\s+per\s+share/i`. Strip commas, parse float, return.

8. Implement `extractWarrantsCount(text: string): number | null`:
   - Anchor on `/warrants?\s+to\s+purchase|warrants?\s+exercisable/i`.
   - Same pattern as shares — `±FIELD_CONTEXT_CHARS` window, look for `([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+warrants?` near the anchor.

9. Implement `classifyOfferingType(bodyText: string, formType: string, item8K: '3.02' | '1.01' | null): OfferingType`:
   - If `item8K === '3.02'`, return `'PIPE'` immediately (item code is authoritative).
   - Otherwise, run keyword checks in this order, return the first match:
     1. `/at[-\s]the[-\s]market|\bATM\b/i` → `'ATM USED'`
     2. `/registered\s+direct/i` → `'REGISTERED DIRECT'`
     3. `/best\s+efforts/i` AND `/placement\s+agent/i` → `'BEST EFFORTS'`
     4. `/private\s+placement|\bPIPE\b/i` → `'PRIVATE PLACEMENT'`
     5. `/initial\s+public\s+offering|\bIPO\b/i` → `'IPO'`
     6. `/shelf\s+takedown/i` OR `formType === '424B5'` → `'SHELF TAKEDOWN'`
     7. `formType === '424B1'` OR `formType === '424B4'` → `'PUBLIC OFFERING'`
     8. Default → `'REGISTERED OFFERING'`

10. Implement and export `extractOfferingFrom424B(text: string, formType: string): ExtractedOfferingFields | null`:
    - Run `findOfferingSection(text)`. If null, return null.
    - Run `detectSellingStockholderResale(text)`.
    - Within the section text, run amount/shares/price/warrants extractors.
    - For `extractDollarAmount`, use anchor patterns: `[/gross\s+proceeds/i, /aggregate\s+offering\s+price/i]`.
    - Run `classifyOfferingType(section, formType, null)`.
    - Return `{ offeringType, sharesAmount, sharePrice, offeringAmount, warrantsAmount, isSellingStockholderResale }`.
    - If all four numeric fields are null AND `offeringType === 'REGISTERED OFFERING'` (i.e. classification fell to default) AND `isSellingStockholderResale === false`, return null — there was nothing distinguishing about this filing. (Resale rows are kept regardless so the projection layer can filter them.)

11. Implement and export `extractOfferingFrom8K302(text: string): ExtractedOfferingFields | null`:
    - Find anchor `/Item\s+3\.02/i` in text. If not found, return null.
    - Slice text from anchor forward by `ANCHOR_WINDOW_CHARS` (8-K bodies are smaller; no fallback needed).
    - Run amount/shares/price/warrants extractors against this section.
    - Set `offeringType: 'PIPE'` (item code is authoritative).
    - `isSellingStockholderResale: false` (8-K 3.02 is by definition the issuer; not applicable).
    - Return the fields. Do not require any field to be non-null — a 3.02 with all nulls is still a valid PIPE event.

12. Implement and export `extractOfferingFrom8K101(text: string): ExtractedOfferingFields | null`:
    - Find anchor `/Item\s+1\.01/i`. If not found, return null.
    - Slice text from anchor forward by `ANCHOR_WINDOW_CHARS`.
    - Skip if section text does NOT contain any of: `/securities\s+purchase\s+agreement/i`, `/placement\s+agency\s+agreement/i`, `/at[-\s]the[-\s]market\s+(?:offering\s+)?agreement/i`, `/equity\s+distribution\s+agreement/i`, `/underwriting\s+agreement/i` — these are the agreement classes that signal an offering. Anything else (license agreements, M&A, etc.) returns null.
    - Run amount/shares/price/warrants extractors.
    - Run `classifyOfferingType(section, '8-K', '1.01')` — note item is `'1.01'` here so it falls through to keyword scan (PIPE shortcut only fires on 3.02).
    - `isSellingStockholderResale: false`.
    - Return fields.

**File:** `__tests__/sec-offerings-parser.test.ts`
**Action:** CREATE

13. Mirror the structure of `__tests__/sec-reverse-splits-parser.test.ts`. Test cases (each as a separate `it()`):
    - **`extractOfferingFrom424B`** — synthetic 424B5 ATM body with "at-the-market", `$5.0 million` gross proceeds, `2,000,000 shares of common stock`, `$2.50 per share` → returns `{ offeringType: 'ATM USED', sharesAmount: 2_000_000, sharePrice: 2.5, offeringAmount: 5_000_000, warrantsAmount: null, isSellingStockholderResale: false }`.
    - 424B3 registered direct with all four fields.
    - 424B5 with "up to $X" language but no firm "gross proceeds" → `offeringAmount: null`, other fields extracted.
    - 424B with no anchor → falls back to first 60K chars; if still no extraction, returns null.
    - Resale 424B (contains "selling stockholders" in first 5K chars) → returns row with `isSellingStockholderResale: true`, type classification still runs.
    - **`extractOfferingFrom8K302`** — synthetic 8-K with `Item 3.02`, `$3 million`, `1,500,000 shares`, `$2.00 per share` → `offeringType: 'PIPE'` regardless of body language.
    - 8-K 3.02 with no field extractions → returns row with all numeric fields null but `offeringType: 'PIPE'`.
    - 8-K body without `Item 3.02` anchor → returns null.
    - **`extractOfferingFrom8K101`** — 8-K with `Item 1.01` and "securities purchase agreement" language → returns extracted fields.
    - 8-K with `Item 1.01` and license-agreement language (no SPA/placement/ATM keywords) → returns null.
    - **`detectSellingStockholderResale`** — positive: phrase in first 5K chars. Negative: phrase appears at char position 10,000.
    - **`classifyOfferingType`** — verify the 8-step ordering: 3.02 short-circuits to PIPE, ATM beats registered direct, etc.

**Acceptance criteria for Phase 1:**
- [ ] `lib/sec/offerings-extractors.ts` exists with all exports listed in steps 2, 10, 11, 12.
- [ ] All test cases in step 13 pass via `npm test -- sec-offerings-parser`.
- [ ] No `any` types in the new file. All exported functions have explicit return types.
- [ ] `npm run lint` clean for the new file.

---

#### Phase 2 — Orchestrator + integration tests

**File:** `lib/sec/offerings.ts`
**Action:** CREATE

14. Imports at the top:
    ```ts
    import { getCikForTicker } from '@/lib/sec/cik-map';
    import { getFilingBody } from '@/lib/sec/filing-body';
    import {
      extractOfferingFrom424B,
      extractOfferingFrom8K101,
      extractOfferingFrom8K302,
      type ExtractedOfferingFields,
      type RawOffering,
    } from '@/lib/sec/offerings-extractors';
    import { getRecentFilings } from '@/lib/sec/submissions';
    ```

15. Re-export `RawOffering` from this module (so callers don't need to import from extractors): `export type { RawOffering } from '@/lib/sec/offerings-extractors';`.

16. Define `OfferingsResponse` (mirrors `ReverseSplitsResponse` shape so the registry runner contract holds):
    ```ts
    export interface OfferingsResponse {
      status: 'success' | 'error';
      count: number;
      results: RawOffering[];
      error?: string;
    }
    ```

17. Module-level constants:
    ```ts
    const DEFAULT_SINCE_DAYS = 730;     // 24 months
    const DEFAULT_LIMIT = 50;
    const FORM_424B_REGEX = /^424B[1-7]$/i;
    const FORM_8K_REGEX = /^8-K(\/A)?$/i;
    ```

18. Implement and export `getOfferings(rawTicker: string, options?: { sinceDays?: number; limit?: number }): Promise<OfferingsResponse>`:

    Order of operations:
    1. CIK lookup via `getCikForTicker(rawTicker)` wrapped in try/catch — on throw, return `{ status: 'error', count: 0, results: [], error: <message> }`.
    2. If `cikEntry` is null, return `{ status: 'success', count: 0, results: [] }`.
    3. Call `getRecentFilings(rawTicker, { limit: options?.limit ?? DEFAULT_LIMIT, sinceDays: options?.sinceDays ?? DEFAULT_SINCE_DAYS })`.
    4. If `filings.status === 'error'`, return `{ status: 'error', count: 0, results: [], error: filings.error ?? 'SEC submissions lookup failed' }`.
    5. Filter `filings.results` to candidates:
       - 424B path: `FORM_424B_REGEX.test(filing.form_type)`
       - 8-K 3.02 path: `FORM_8K_REGEX.test(filing.form_type) && (filing.items === null || filing.items.includes('3.02'))`
       - 8-K 1.01 path: `FORM_8K_REGEX.test(filing.form_type) && (filing.items === null || filing.items.includes('1.01'))`
       - Note: same 8-K may match both 3.02 and 1.01. Process under whichever item matches first (3.02 takes precedence — see step 6 below for the routing logic).
    6. For each candidate filing, fetch body via `getFilingBody({ accessionNumber, cik: cikEntry.cik, formType: filing.form_type, filedAt: filing.filed_at, primaryDocUrl: filing.url })`. Skip if body is null.
    7. Route to extractor:
       - 424B → `extractOfferingFrom424B(body.text, filing.form_type)`
       - 8-K with items containing `3.02` → `extractOfferingFrom8K302(body.text)` (3.02 wins over 1.01 if both present)
       - 8-K with items containing `1.01` (and not 3.02) → `extractOfferingFrom8K101(body.text)`
    8. If extractor returns null, skip.
    9. Build `RawOffering` row:
       ```ts
       results.push({
         accessionNumber: filing.accession_number,
         formType: filing.form_type,
         filedAt: filing.filed_at,
         url: filing.url,
         ...extracted,    // spreads ExtractedOfferingFields
       });
       ```
    10. After the loop, sort `results` newest-first: `results.sort((a, b) => b.filedAt.localeCompare(a.filedAt))`.
    11. Return `{ status: 'success', count: results.length, results }`.

**File:** `__tests__/sec-offerings.test.ts`
**Action:** CREATE

19. Mirror `__tests__/sec-reverse-splits.test.ts` structure. Mock `@/lib/sec/cik-map`, `@/lib/sec/submissions`, `@/lib/sec/filing-body`. Test cases:
    - Mixed-form scan (one 424B5 + one 8-K Item 3.02 + one 8-K Item 1.01 + one irrelevant 10-Q) → returns 3 rows in newest-first order.
    - Resale 424B included in raw results with `isSellingStockholderResale: true` (filtering does NOT happen here).
    - Unknown ticker (CIK lookup returns null) → `{ status: 'success', count: 0, results: [] }`.
    - SEC submissions returns error → `{ status: 'error', count: 0, results: [], error: <message> }`.
    - 424B body missing offering anchor and producing no extractions → row skipped (not error).
    - 8-K body where `getFilingBody` returns null → row skipped.
    - CIK lookup throws → returns error response with the error message.
    - 8-K with both items 3.02 and 1.01 → routed through 3.02 path (PIPE wins).

**Acceptance criteria for Phase 2:**
- [ ] `lib/sec/offerings.ts` exists with `getOfferings`, `OfferingsResponse`, and a re-export of `RawOffering`.
- [ ] All test cases in step 19 pass via `npm test -- sec-offerings`.
- [ ] No `any` types. All exports have explicit return types.

---

#### Phase 3 — Wire into AskEdgar fan-out

**File:** `lib/askedgar.ts`
**Action:** MODIFY

20. **Add import** near the top of the file alongside existing `@/lib/sec/*` imports (look for `getReverseSplits` import and add right after):
    ```ts
    import { getOfferings } from '@/lib/sec/offerings';
    ```
    Also import the type for the projection step:
    ```ts
    import type { RawOffering } from '@/lib/sec/offerings';
    ```
    (Combine into one import if both come from `@/lib/sec/offerings`.)

21. **Add `'offerings'` to `SEC_BACKED_ENDPOINT_KEYS`** at lines 58-62. After change:
    ```ts
    const SEC_BACKED_ENDPOINT_KEYS = new Set<string>([
      'historical-float-pro',
      'reverse-splits',
      'filing-titles',
      'offerings',
    ]);
    ```

22. **Delete `fetchOfferings` function** at lines 409-413. Do NOT delete `fetchEquityLines` at lines 415-419 — it stays AskEdgar-backed.

23. **Update `ENDPOINT_REGISTRY` entry** at line 474. Change from:
    ```ts
    offerings: { label: 'Offerings', run: (ticker) => fetchOfferings(ticker, 20) },
    ```
    to:
    ```ts
    offerings: { label: 'Offerings', run: (ticker) => getOfferings(ticker) },
    ```

24. **Update offerings normalizer** at lines 797-812. Replace the entire `const offerings = dedupeByHeadline(...)` block with one that:
    - Reads from `rawData['offerings'].results` (typed as `RawOffering[]` after our parser swap).
    - Filters out rows where `isSellingStockholderResale === true`.
    - Builds the headline from extracted fields.
    - Maps to `ResearchSnapshotOffering`.
    - Wraps in `dedupeByHeadline()`.

    Add a helper function above `normalizeAskEdgarResponse` (near other helpers like `toRegistrationRow`):
    ```ts
    function buildOfferingHeadline(row: {
      offeringType: string | null;
      sharesAmount: number | null;
      sharePrice: number | null;
      offeringAmount: number | null;
      formType: string;
    }): string {
      const hasFields = row.sharesAmount !== null || row.sharePrice !== null || row.offeringAmount !== null;
      if (!hasFields) {
        const typeLabel = row.offeringType ?? 'Offering';
        return `${typeLabel} (${row.formType})`;
      }
      const parts: string[] = [row.offeringType ?? 'Offering'];
      if (row.sharesAmount !== null) parts.push(`${row.sharesAmount.toLocaleString('en-US')} shares`);
      if (row.sharePrice !== null) parts.push(`@ $${row.sharePrice.toFixed(2)}`);
      if (row.offeringAmount !== null) {
        const amt = row.offeringAmount;
        const formatted = amt >= 1_000_000_000 ? `$${(amt / 1_000_000_000).toFixed(1)}B`
          : amt >= 1_000_000 ? `$${(amt / 1_000_000).toFixed(1)}M`
          : `$${amt.toLocaleString('en-US')}`;
        parts.push(`— ${formatted}`);
      }
      return parts.join(' — ').replace(/—\s*—/, '—');    // collapse double dashes
    }
    ```

    Replace the offerings block:
    ```ts
    const offerings = dedupeByHeadline(
      (getEndpointResponse(rawData, ['offerings']).results as RawOffering[])
        .filter((row) => !row.isSellingStockholderResale)
        .map((row) => ({
          headline: buildOfferingHeadline(row),
          filedAt: row.filedAt,
          offeringType: row.offeringType,
          sharesAmount: row.sharesAmount,
          warrantsAmount: row.warrantsAmount,
          sharePrice: row.sharePrice,
          offeringAmount: row.offeringAmount,
        } satisfies ResearchSnapshotOffering))
        .filter((row) => !String(row.offeringType ?? '').toUpperCase().includes('EQUITY LINE')),
    );
    ```
    Note: the trailing `EQUITY LINE` filter stays as defensive code — `getOfferings` won't emit it, but the filter is harmless.

**Acceptance criteria for Phase 3:**
- [ ] `fetchOfferings` no longer exists in `lib/askedgar.ts`.
- [ ] `ENDPOINT_REGISTRY.offerings.run` calls `getOfferings(ticker)`.
- [ ] `SEC_BACKED_ENDPOINT_KEYS` contains `'offerings'`.
- [ ] `buildOfferingHeadline` helper exists and is used in the mapper.
- [ ] Resale rows are filtered out in the projection layer.
- [ ] `npm run lint && npx tsc --noEmit` clean.

---

#### Phase 4 — Remove `pump-and-dump-tracker`

**File:** `lib/askedgar.ts`
**Action:** MODIFY

25. **Delete `fetchPumpAndDumpTracker`** at lines 439-443.

26. **Delete registry entry** at line 479:
    ```ts
    'pump-and-dump-tracker': { label: 'Pump and Dump Tracker', run: (ticker) => fetchPumpAndDumpTracker(ticker) },
    ```

27. **Remove from `'small-cap-research'` scope array** at lines 499-504. Remove the `'pump-and-dump-tracker'` entry from the array. (The `snapshot`, `tldr`, `lookup` scopes use `ALL_ENDPOINT_KEYS` so they're updated automatically by step 26.)

28. **Delete `pumpAndDump` lookup** at line 780:
    ```ts
    const pumpAndDump = firstResult(rawData, ['pump-and-dump-tracker', 'pumpAndDumpTracker']);
    ```

29. **Update `overallRisk` field** at line 993. Change from:
    ```ts
    overallRisk: getStringField(pumpAndDump, ['overall_risk', 'overallRisk', 'scam_risk', 'scamRisk']),
    ```
    to:
    ```ts
    overallRisk: null,
    ```

30. **Update `regsho` field** at line 994. Change from:
    ```ts
    regsho: getBooleanField(compliance, ['regsho']) || getBooleanField(pumpAndDump, ['regsho']),
    ```
    to:
    ```ts
    regsho: getBooleanField(compliance, ['regsho']),
    ```

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

31. **Delete input schema field** at line 48:
    ```ts
    pumpAndDumpTracker: z.unknown().nullable(),
    ```

32. **Delete prompt assembly line** at line 773:
    ```ts
    `pumpAndDumpTracker:\n${wrapUntrusted('filing', JSON.stringify(input.pumpAndDumpTracker, null, 2))}`,
    ```
    (The line above and below stay intact — this is a single line removal.)

33. **Delete input wiring** at line 832:
    ```ts
    pumpAndDumpTracker: readResults(rawData['pump-and-dump-tracker'])[0] ?? null,
    ```

**File:** `__tests__/research-snapshot-mapper.test.ts`
**Action:** MODIFY

34. **Remove pump-and-dump-tracker fixture line** at line 20:
    ```ts
    'pump-and-dump-tracker': emptyResponse,
    ```

**File:** `__tests__/agent-blueprints.test.ts`
**Action:** MODIFY

35. **Remove `pumpAndDumpTracker: null` lines** at lines 1425 and 2338. Both are inside blueprint-input fixtures and the field is no longer in the input schema.

**Acceptance criteria for Phase 4:**
- [ ] `fetchPumpAndDumpTracker` no longer exists in `lib/askedgar.ts`.
- [ ] `'pump-and-dump-tracker'` is not in `ENDPOINT_REGISTRY` or any `ENDPOINT_SCOPES` array.
- [ ] `overallRisk` is hardcoded `null` in the snapshot.
- [ ] `regsho` reads from `compliance` only.
- [ ] No remaining references to `pumpAndDumpTracker` or `pump-and-dump-tracker` in `lib/`, `app/`, or `__tests__/` (verify via `grep -rn "pump-and-dump\|pumpAndDump" lib app __tests__ 2>/dev/null` — should return zero results).

---

#### Phase 5 — Validation + handoff updates

36. Run validation in order:
    ```bash
    npm run lint
    npx tsc --noEmit
    npm test
    npm run workflow:audit
    ```
    All must pass. Test count should increase from 486 → ~500+ (15+ new tests added across Phases 1 and 2).

37. **Update `HANDOFF.md`** Active Specs section: change Status to IMPLEMENTED, move spec to Validation Snapshot with commit SHA + test count + a one-paragraph description of what shipped. Replace this Active Specs section with `None.` and a new "Next to plan" pointer (suggest endpoint-usage audit on `screener` / `ownership` / `nasdaq-compliance`).

38. **Check off basic `offerings` in `docs/ae-buildout.md`** at line 60:
    ```
    - [x] Basic `offerings` — shipped <date> (`<sha>`) via `lib/sec/offerings.ts` (424B + 8-K Item 3.02 + 8-K Item 1.01 parser)
    ```

39. **Add Follow-Up Note** in HANDOFF.md:
    - Note that `screener` removal is deferred — needs replacement source for `marketCap`, `outstandingShares`, `float`, `exchange`, `ipoDate`, `industry`, `country`, `shortInterest`, `volume` header fields.
    - Update the "Endpoint review pending" note: remove `pump-and-dump-tracker` from the "likely-removable" list (shipped this sprint), keep `screener`, `ownership`, `nasdaq-compliance` (defer; `split-status` is parked separately in auto-memory).
    - Note future work: DEBT OFFERING / DEBT CONVERSION / CREDIT FACILITY / SHARE ISSUANCE FOR ACQUISITION / UPLIST classifications were intentionally excluded from `OfferingType` union — add if real filings exercise them.

40. **Do NOT push a commit** — leave that to the user.

---

#### Files Changed Summary

| File | Action | Risk | Notes |
|---|---|---|---|
| `lib/sec/offerings-extractors.ts` | CREATE | Low | Pure functions, fully unit-tested |
| `lib/sec/offerings.ts` | CREATE | Low | Mirrors reverse-splits.ts structure |
| `__tests__/sec-offerings-parser.test.ts` | CREATE | Low | ~12 unit tests |
| `__tests__/sec-offerings.test.ts` | CREATE | Low | ~7 integration tests |
| `lib/askedgar.ts` | MODIFY | **Med** | Touches registry, mapper, P&D removal — most risk surface |
| `lib/agents/blueprints/small-cap-research.ts` | MODIFY | Low | P&D field removal only (3 lines) |
| `__tests__/research-snapshot-mapper.test.ts` | MODIFY | Low | Single fixture line removal |
| `__tests__/agent-blueprints.test.ts` | MODIFY | Low | Two fixture line removals |
| `HANDOFF.md` | MODIFY | Low | Validation snapshot + follow-up notes |
| `docs/ae-buildout.md` | MODIFY | Low | Check-off line 60 |

#### Verification Steps

```bash
# Type + lint + test pipeline
npm run lint
npx tsc --noEmit
npm test
npm run workflow:audit

# Sanity checks
grep -rn "pump-and-dump\|pumpAndDump\|fetchPumpAndDumpTracker" lib app __tests__ 2>/dev/null
# Expected: zero results

grep -n "fetchOfferings\|fetchPumpAndDumpTracker" lib/askedgar.ts
# Expected: zero results

grep -n "getOfferings" lib/askedgar.ts
# Expected: import line + ENDPOINT_REGISTRY entry

grep -n "'offerings'" lib/askedgar.ts | head -5
# Expected: SEC_BACKED_ENDPOINT_KEYS, ENDPOINT_REGISTRY, ENDPOINT_SCOPES['small-cap-research'], ENDPOINT_SCOPES['swing-trader-research']
```

Manual smoke (after deploy or locally with auth):
- Open Research view for a known active small-cap (e.g. `MULN`, `GLND`, or any current gainer with recent 424B activity).
- Confirm Offerings tab still renders rows with Date / Type / Shares / Price / Amount columns.
- Confirm `overallRisk` is null in the snapshot (header still renders without crashing).
- Confirm gainers feed at `/api/tradingview/gainers` still works (uses `fetchTopGainers` — untouched).

---

## Validation Snapshot

- AskEdgar Sprint 3 Part A (`2026-04-29`, committed `003aa8c`): added `secFetchText()` in `lib/sec/client.ts`, shared filing-body cache table `sec_filing_body_cache` via `drizzle/0026_low_wilson_fisk.sql`, `lib/sec/filing-body.ts`, and `lib/sec/reverse-splits.ts` (8-K Item 5.03 parser); swapped `reverse-splits` registry entry in `lib/askedgar.ts` to the SEC parser; introduced `SEC_BACKED_ENDPOINT_KEYS` so SEC-only data does not suppress AskEdgar retry-window caching. `npm run db:migrate` applied successfully to Neon. `npm run lint`, `npx tsc --noEmit`, `npm test` (486/486 after audit fixes), `npm run workflow:audit` passed. Manual browser smoke pending. Review verdict 2026-04-29: PASS — audit fixes applied (parseWordNumber trim, onConflictDoNothing, items empty-string coercion).
- Filings v1 (`2026-04-29`, committed `9d31489`): added `filings` to the research snapshot contract, bucketed SEC form-type mapping via `lib/filings-bucket.ts`, SEC `items` passthrough in `lib/sec/submissions.ts`, split Research `News`/`Filings` UI, and tests in `__tests__/filings-bucket.test.ts`, `__tests__/research-snapshot-mapper.test.ts`, `__tests__/sec-submissions.test.ts`. Validation green at ship time. Review verdict 2026-04-29: PASS.
- Backtesting Phase 3 (`2026-04-28`, committed `8032710` + polish `f2f4087`/`c29b25a`/`6456f69`): all validation green at Phase 3 ship.
- Backtesting Phase 2 (`2026-04-28`, committed `745958d`): tests 457/457 green.
- Backtesting Phase 1 (`2026-04-28`, committed `4633b30`): `drizzle/0025_blue_joseph.sql` applied; tests 454/454 green.
- AskEdgar Sprint 2 (`2026-04-27`, committed `cbde6ee`): `historical-float-pro` swapped to SEC companyfacts; `0024_acoustic_jocasta.sql` applied.
- AskEdgar Sprint 1 (`2026-04-27`, committed `b4a3e73`): `filing-titles` swapped to SEC submissions.

## Follow-Up Notes

- **Backtesting drawings still don't render (2026-04-28).** Refactor work captured the `armedAction`/`onArmedClick`/`onAnchorChange` callbacks in refs and memoized `handleArmedClick`; execution arrows + stop line render fine, but user-drawn trendlines/horizontals/rectangles still don't appear. Suspect canvas overlay sizing (parent `clientWidth/Height` is 0 on first mount) or pointer-events stealing clicks before `chart.subscribeClick` fires. Investigate by adding console logs in `ChartDrawings.tsx:212` (handleClick), `ChartDrawings.tsx:289` (handleCrosshairMove), `ChartDrawings.tsx:405` (renderDrawings) and inspecting the canvas DOM rect in DevTools.
- **GLND "no financial commentary" (2026-04-27).** Originally suspected to be a Sprint 1 bug. Confirmed unrelated: `managementCommentary` is read from AskEdgar's `dilution-data[0].management_commentary`, not from `filing-titles` (`lib/agents/blueprints/small-cap-research.ts:816`). Re-check after Sprint 4 ships; if it persists, triage as a separate AskEdgar payload investigation.
- **Filings v2 (deferred) — in-app viewer.** AskEdgar-style filing reader (iframe of the SEC primary document with Exhibits sidebar from `<accession>/index.json`, browser-native Ctrl+F inside the iframe). ~1-2 days. Defer until we have user feedback on the click-out flow.
- **Filings v3 (deferred) — full-text search + AI Copilot.** "Search in Documents" across all filings for a ticker requires Postgres `tsvector` ingestion or external index. AI Copilot panel (Summarize / Key Points / Catalysts) plumbs into existing agent infra. Cost analysis required first.
- **Auto stop-out for Backtesting (deferred).** When intraday bar prints through a stop, simulator should auto-execute SELL/COVER. Schema supports it. UI: settings toggle defaulting OFF for parity. Add when user requests.
- **Backtest analytics roll-up (idea).** REVIEWED sessions are a corpus of practiced setups — could surface aggregate stats. Out of scope for Backtesting v1.
- **News-formatter UX trade.** Filing feeds default to `${formType} filing` labels via fallback in `lib/agents/news-formatter.ts:198`. AI headlines deferred to buildout-doc Phase 8.
- **AskEdgar Sprint 3 Part B (`split-status`) — PARKED.** Researched + planned 2026-04-29; full design captured in auto-memory `project_split_status_research.md`. Pending endpoint-usage audit before commit. Reusable artifacts: state machine design (4 states), source precedence, section-locator approach for DEF 14A.
- **AskEdgar paid API key.** `https://eapi.askedgar.io` remains the correct base URL. Only swap `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles`, Sprint 2 dropped `historical-float-pro`, Sprint 3 Part A dropped `reverse-splits`, Sprint 4 drops `offerings` + `pump-and-dump-tracker` from AskEdgar fan-out. Track via `[askedgar-fanout]` log's `costUsd` token.
- **Endpoint review pending (2026-04-29).** User flagged for future scrutiny: `screener`, `ownership`, `nasdaq-compliance` (likely-removable; `pump-and-dump-tracker` removed in Sprint 4); `historical-float-pro`, `float-outstanding` (review payload). `split-status` is parked separately. Next planning candidate after Sprint 4 ships.
- **Sprint 4 — `screener` removal deferred.** Per-ticker `/v1/screener` feeds 9 header fields (`marketCap`, `outstandingShares`, `float`, `exchange`, `ipoDate`, `industry`, `country`, `shortInterest`, `volume`) in `normalizeAskEdgarResponse` (`lib/askedgar.ts:972-986`). Removing without a replacement breaks the Research card header. `getCachedGainers` / `fetchTopGainers` use the same `/v1/screener` endpoint with different params and stay independent. Plan a header-fields replacement (companyfacts gives shares-out, market cap needs price * shares, exchange/industry possibly from `sec_ticker_cik`) before removing.
- **Sprint 4 follow-up — extended `OfferingType` union.** v1 intentionally excludes DEBT OFFERING / DEBT CONVERSION / CREDIT FACILITY / SHARE ISSUANCE FOR ACQUISITION / UPLIST. Add if real filings exercise them. Revisit if blueprints start filtering by type.
- **Sprint 3 Part A audit nits (low priority — RESOLVED 2026-04-29).** All 3 audit fixes applied: `parseWordNumber` trim fix (handles "one-" hyphen-bleed), `persistCache` switched to `onConflictDoNothing` (filings are immutable), `submissions.ts` items field coerces empty-string → null. Tests 486/486.
