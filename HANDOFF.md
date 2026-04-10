# Nexus Terminal — HANDOFF.md

> Historical completed sections (Sprints 1–3, Sprint 4 Checkpoints 1–7) were removed to keep this file focused. Use git history and `AEV2_PLAN.md` for archived implementation detail.

### Workflow Tooling Note

- 2026-04-06: Added a repo-maintained Codex `commit` alias skill in [`codex-skills/commit/`](/home/jared/Nexus-Terminal/codex-skills/commit) and UI metadata for [`codex-skills/nexus-commit/`](/home/jared/Nexus-Terminal/codex-skills/nexus-commit) so Codex can surface a user-facing commit entry point while keeping `nexus-commit` as the canonical workflow.
- 2026-04-07: Audited the Codex harness docs and refreshed [`AGENTS.md`](/home/jared/Nexus-Terminal/AGENTS.md) plus repo-maintained skill sources in [`codex-skills/`](/home/jared/Nexus-Terminal/codex-skills) to remove stale `.claude`/`.opencode` assumptions, fix the `lib/trade-utils.ts` path, and document repo-local skill agent metadata.

---

## AEV2 Sprint 4 — COMPLETE (2026-04-10)

> Docker, Discord Bot & Launch Hardening (EPIC-5: AEV2-501 through AEV2-510)

**What shipped:** 3 agent containers (orchestrator, small-cap-trader, swing-trader) + Discord bot running on OptiPlex home server via Docker Compose. All agents healthy, bot connected, smoke tests passed.

**Launch fixes applied during deploy:**
- Added `ws` package for Neon WebSocket connections in Docker (conditional load — skipped on Vercel)
- Enabled Discord Gateway privileged intents (Message Content)
- Ran migration 0019 to create agent tables + seed registry rows
- Improved bot error logging (actual error message on fatal crash)

**Smoke results (2026-04-10):**
- Orchestrator chat: direct reply received
- Routed to specialist: `/research` forwarded to small-cap-trader, embed posted
- Offline fallback: stopped small-cap-trader, orchestrator handled directly
- Team members (Branden, Cody) added to DISCORD_USER_MAP and tested successfully

**Next:** Agent response quality improvements — see `FUTURE-PLANS.md` (P0–P3 roadmap).

---

## AskEdgar — Rate Limit Corrections + Split Status Endpoint

> Generated: 2026-04-09 | Agent: nexus-architect
> Status: COMPLETE — implemented 2026-04-09 (`npm run lint`, `npx tsc --noEmit`, and `npm test` all pass)

### Objective

Update the AskEdgar integration to reflect the actual API limits (150 req/min, 50 unique tickers/day), add the new `/v1/split-status` reverse split tracker as the 17th data source, and update the local API docs. No new dependencies, no schema changes, no new API routes.

### Current State

- **`lib/askedgar.ts`** — `DEFAULT_DAILY_LIMIT = 100` counts raw API calls (not unique tickers). With 16 endpoints per ticker, the guard fires after ~6 lookups. `BATCH_SIZE = 5` with a comment referencing "50/min rate limit" (wrong — it's 150/min). `EndpointKey` union has 16 members. No `fetchSplitStatus()` function.
- **`lib/types.ts`** — `ResearchSnapshot` has `reverseSplits` (for completed splits from `/v1/reverse-splits`). No `splitStatuses` field or `ResearchSnapshotSplitStatus` interface.
- **`components/trading/ResearchReportSections.tsx`** — History tab shows: historical float, reverse splits, agreements. No split-status section.
- **`docs/AE_API_DOCS.md`** — No rate limit section. No `/v1/split-status` docs. Missing 5 newer endpoints.
- **`__tests__/askedgar-client.test.ts`** — Expects 16 endpoints, `callCount` of 16, batch-of-5 behavior.

---

### Phase 1: Rate Limit Corrections

#### Step 1 — Update `DEFAULT_DAILY_LIMIT` and batch size constants

**File:** `lib/askedgar.ts`
**Action:** MODIFY

1. Line 42 — change `const DEFAULT_DAILY_LIMIT = 100;` to `const DEFAULT_DAILY_LIMIT = 50;`

2. Line 487 — change `const BATCH_SIZE = 5;` to `const BATCH_SIZE = 10;`

3. Lines 484–486 — replace the comment:
   ```
   // Run endpoints in batches of 5 to avoid blowing through the 50/min rate limit.
   // 16 parallel requests would use 32% of the limit in one shot; batching spreads
   // the load and lets the rate-limit guard kick in between batches if needed.
   ```
   with:
   ```
   // Run endpoints in batches of 10 to stay well within the 150/min API rate limit.
   // 17 endpoints at batch size 10 = 2 batches, leaving ample headroom.
   // Batching also lets the rate-limit guard kick in between batches if needed.
   ```

**Acceptance criteria:**
- [x] `DEFAULT_DAILY_LIMIT` is `50`
- [x] `BATCH_SIZE` is `10`
- [x] Comment references 150/min, not 50/min
- [x] Comment mentions 17 endpoints

#### Step 2 — Refactor daily limit from raw call count to unique tickers

**File:** `lib/askedgar.ts`
**Action:** MODIFY

This is the most structural change. The actual API constraint is 50 unique tickers/day, not a raw call count.

1. **Replace the counter variables** (lines 48–49). Change:
   ```ts
   let callCount = 0;
   let resetDate = '';
   ```
   to:
   ```ts
   const uniqueTickersToday = new Set<string>();
   let resetDate = '';
   ```

2. **Update `resetCounterIfNeeded()`** (lines 69–75). Change `callCount = 0;` to `uniqueTickersToday.clear();`

3. **Remove the daily limit check from `requestAskEdgar()`** (lines 232–234). Delete these three lines:
   ```ts
   resetCounterIfNeeded();
   const dailyLimit = parseDailyLimit();
   if (callCount >= dailyLimit) return toErrorResponse<T>(`AskEdgar daily limit reached (${dailyLimit})`);
   ```
   Keep the `isRateLimited()` check (line 230) and the API key check (line 227) — those stay.

4. **Remove the call count increment from `requestAskEdgar()`** (line 242). Delete `callCount += 1;`

5. **Add the unique ticker daily limit check to `fetchTickerData()`** (line 462). After `const normalizedTicker = ticker.trim().toUpperCase();` and before the `endpointConfigs` array, add:
   ```ts
   resetCounterIfNeeded();
   const dailyLimit = parseDailyLimit();
   if (!uniqueTickersToday.has(normalizedTicker) && uniqueTickersToday.size >= dailyLimit) {
     return {
       ticker: normalizedTicker,
       fetchedAt: new Date().toISOString(),
       rawData: {},
       dataSources: [],
       warnings: [`AskEdgar daily unique ticker limit reached (${dailyLimit} tickers/day)`],
       hasAnyData: false,
     };
   }
   uniqueTickersToday.add(normalizedTicker);
   ```
   **Why `!uniqueTickersToday.has(normalizedTicker)` first:** If we already fetched this ticker today (it's in the set), we should allow a re-fetch — the limit is on *unique* tickers, not total calls. Only block if this ticker is new AND the set is full.

6. **Update `getAskEdgarCallCount()`** (line 874). Change:
   ```ts
   export function getAskEdgarCallCount() {
     resetCounterIfNeeded();
     return callCount;
   }
   ```
   to:
   ```ts
   export function getAskEdgarCallCount() {
     resetCounterIfNeeded();
     return uniqueTickersToday.size;
   }
   ```
   Keep the name as-is to avoid breaking the test import. The semantics change from "raw calls" to "unique tickers" but the caller (the test) will be updated in Step 8.

**Acceptance criteria:**
- [x] `uniqueTickersToday` is a `Set<string>`, not a numeric counter
- [x] `resetCounterIfNeeded()` calls `.clear()`, not `= 0`
- [x] `requestAskEdgar()` has NO daily limit check and NO call count increment (only the `isRateLimited()` and API key checks remain)
- [x] `fetchTickerData()` checks `uniqueTickersToday.size >= dailyLimit` before the batch loop
- [x] Re-fetching an already-seen ticker does NOT count against the limit
- [x] `getAskEdgarCallCount()` returns `uniqueTickersToday.size`

#### Step 3 — Update `.env.example`

**File:** `.env.example` (project root)
**Action:** MODIFY

Find the `ASKEDGAR_DAILY_LIMIT` line and replace it with:
```
# Max unique tickers looked up per day (API enforces 50 unique tickers/day)
ASKEDGAR_DAILY_LIMIT=50
```

**Acceptance criteria:**
- [x] Value is `50`
- [x] Comment says "unique tickers"

---

### Phase 2: Add `/v1/split-status` Endpoint

#### Step 4 — Add `ResearchSnapshotSplitStatus` type

**File:** `lib/types.ts`
**Action:** MODIFY

1. After the `ResearchSnapshotReverseSplit` interface (around line 184), add:
   ```ts
   export interface ResearchSnapshotSplitStatus {
     actionType: string | null;
     splitFrom: number | null;
     splitTo: number | null;
     voteDate: string | null;
     approvedDate: string | null;
     effectiveDate: string | null;
     details: string | null;
     filedAt: string | null;
     formType: string | null;
     documentUrl: string | null;
     lastUpdated: string | null;
   }
   ```

2. In the `ResearchSnapshot` interface, add `splitStatuses: ResearchSnapshotSplitStatus[];` immediately after the `reverseSplits` line (currently line 230), before `agreements`.

3. Update the comment on line 207 ("full 16-endpoint payload") — change `16` to `17`.
4. Update the comment on line 235 ("full 16-endpoint payload") — change `16` to `17`.

**Acceptance criteria:**
- [x] `ResearchSnapshotSplitStatus` interface exists with 11 fields
- [x] `ResearchSnapshot.splitStatuses` field exists between `reverseSplits` and `agreements`
- [x] Both "16-endpoint" comments updated to "17-endpoint"

#### Step 5 — Add fetch function, endpoint key, and import

**File:** `lib/askedgar.ts`
**Action:** MODIFY

1. Add `ResearchSnapshotSplitStatus` to the import block (lines 6–18):
   ```ts
   import type {
     ResearchSnapshotFull,
     ResearchSnapshotAgreement,
     ResearchSnapshotGapStat,
     ResearchSnapshotHistoricalFloatRow,
     ResearchSnapshotNewsItem,
     ResearchSnapshotOffering,
     ResearchSnapshotOwnershipGroup,
     ResearchSnapshotOwner,
     ResearchSnapshotRegistration,
     ResearchSnapshotReverseSplit,
     ResearchSnapshotSplitStatus,
     ResearchSnapshotWarrant,
   } from '@/lib/types';
   ```

2. Add `| 'split-status'` to the `EndpointKey` union type (after `| 'ownership'` at line 312):
   ```ts
   type EndpointKey =
     | 'float-outstanding'
     | 'screener'
     | 'dilution-rating'
     | 'dilution-data'
     | 'offerings'
     | 'registrations'
     | 'news'
     | 'nasdaq-compliance'
     | 'pump-and-dump-tracker'
     | 'agreements'
     | 'historical-float-pro'
     | 'reverse-splits'
     | 'filing-titles'
     | 'equity-lines'
     | 'gap-stats'
     | 'ownership'
     | 'split-status';
   ```

3. Add the fetch function after `fetchOwnership()` (around line 460), before `fetchTickerData()`:
   ```ts
   async function fetchSplitStatus(ticker: string) {
     const validated = validateTickerOrError<unknown>(ticker);
     if (typeof validated !== 'string') return validated;
     return requestAskEdgar<unknown>('/v1/split-status', { ticker: validated });
   }
   ```

4. Add the 17th entry to the `endpointConfigs` array in `fetchTickerData()`, after the `ownership` entry:
   ```ts
   { key: 'split-status', label: 'Split Status', run: () => fetchSplitStatus(normalizedTicker) },
   ```

**Acceptance criteria:**
- [x] `ResearchSnapshotSplitStatus` is imported from `@/lib/types`
- [x] `EndpointKey` has 17 members including `'split-status'`
- [x] `fetchSplitStatus()` function exists following the same pattern as all others
- [x] `endpointConfigs` array has 17 entries

#### Step 6 — Add normalization logic for split-status

**File:** `lib/askedgar.ts`
**Action:** MODIFY

In `normalizeAskEdgarResponse()`, after the `reverseSplits` normalization block (around line 785) and before the `agreements` block, add:

```ts
const splitStatuses: ResearchSnapshotSplitStatus[] = getEndpointResponse(rawData, ['split-status', 'splitStatus']).results.map((item) => {
  const row = toRecord(item);
  return {
    actionType: getStringField(row, ['action_type', 'actionType']),
    splitFrom: toNumberValue(getField(row, ['split_from', 'splitFrom'])),
    splitTo: toNumberValue(getField(row, ['split_to', 'splitTo'])),
    voteDate: getStringField(row, ['vote_date', 'voteDate']),
    approvedDate: getStringField(row, ['approved_date', 'approvedDate']),
    effectiveDate: getStringField(row, ['effective_date', 'effectiveDate']),
    details: getStringField(row, ['details']),
    filedAt: getStringField(row, ['filed_at', 'filedAt']),
    formType: getStringField(row, ['form_type', 'formType']),
    documentUrl: getStringField(row, ['document_url', 'documentUrl']),
    lastUpdated: getStringField(row, ['last_updated', 'lastUpdated']),
  } satisfies ResearchSnapshotSplitStatus;
});
```

Then add `splitStatuses,` to the return object, between `reverseSplits,` and `agreements,`.

**Acceptance criteria:**
- [x] `splitStatuses` normalization block exists in `normalizeAskEdgarResponse()`
- [x] Uses `getEndpointResponse` with both `'split-status'` and `'splitStatus'` key fallbacks
- [x] Uses `satisfies ResearchSnapshotSplitStatus` for type safety
- [x] `splitStatuses` is in the return object between `reverseSplits` and `agreements`

#### Step 7 — Add split-status UI section

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. The import block at lines 16–21 currently imports 4 types from `@/lib/types`. No new import needed — the component accesses `splitStatuses` through the `ResearchSnapshot` type on the `data` prop.

2. In the History tab, between the `reverseSplits` table block (ending around line 507) and the `agreements` table block (starting around line 509), insert:

```tsx
{data.splitStatuses.length > 0 ? (
  <div className="space-y-2">
    <h4 className="font-medium text-zinc-300">Split Status</h4>
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10 text-zinc-400">
            <th className="py-2 pr-3 text-left">Status</th>
            <th className="py-2 pr-3 text-left">Ratio</th>
            <th className="py-2 pr-3 text-left">Vote Date</th>
            <th className="py-2 pr-3 text-left">Effective Date</th>
            <th className="py-2 text-left">Details</th>
          </tr>
        </thead>
        <tbody>
          {data.splitStatuses.map((row, index) => (
            <tr key={`split-status-${index}`} className="border-b border-white/5 text-zinc-300">
              <td className="py-2 pr-3">{toStringValue(row.actionType)}</td>
              <td className="py-2 pr-3">
                {row.splitFrom != null && row.splitTo != null
                  ? `${row.splitFrom}:${row.splitTo}`
                  : '—'}
              </td>
              <td className="py-2 pr-3">{formatDate(row.voteDate)}</td>
              <td className="py-2 pr-3">{formatDate(row.effectiveDate)}</td>
              <td className="py-2">{toStringValue(row.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
) : null}
```

**Acceptance criteria:**
- [x] Split-status table renders only when `data.splitStatuses.length > 0`
- [x] Table shows: Status, Ratio (splitFrom:splitTo), Vote Date, Effective Date, Details
- [x] Ratio shows `—` when `splitFrom` or `splitTo` is null
- [x] Section is inside the `activeTab === 'history'` block, between reverseSplits and agreements
- [x] Uses `formatDate` and `toStringValue` consistent with the rest of the file

---

### Phase 3: Update Tests

#### Step 8 — Update `__tests__/askedgar-client.test.ts`

**File:** `__tests__/askedgar-client.test.ts`
**Action:** MODIFY

1. Line 73 — change `process.env.ASKEDGAR_DAILY_LIMIT = '100';` to `process.env.ASKEDGAR_DAILY_LIMIT = '100';` — keep as-is. The test sets its own value; the new default of 50 does not affect tests that set the env var explicitly.

2. Line 88 — change `.toHaveLength(16)` to `.toHaveLength(17)` (rawData now has 17 endpoint keys)

3. Line 89 — change `.toHaveLength(16)` to `.toHaveLength(17)` (dataSources now has 17 entries)

4. Line 97 — change `expect(client.getAskEdgarCallCount()).toBe(16);` to `expect(client.getAskEdgarCallCount()).toBe(1);`
   **Why:** `getAskEdgarCallCount()` now returns unique ticker count, not raw call count. One `fetchTickerData('MSFT')` call = 1 unique ticker.

5. Line 138 — change `expect(fetchSpy).toHaveBeenCalledTimes(5);` to `expect(fetchSpy).toHaveBeenCalledTimes(10);`
   **Why:** First batch size is now 10 (not 5). All 10 requests fire in parallel via `Promise.allSettled`, all return 429, then the rate limit guard blocks subsequent batches.

6. Line 163 — change `expect(fetchSpy).toHaveBeenCalledTimes(16);` to `expect(fetchSpy).toHaveBeenCalledTimes(17);`
   **Why:** 17 endpoints now, all fire (dedup test, successful responses).

**Acceptance criteria:**
- [x] `rawData` length assertion is `17`
- [x] `dataSources` length assertion is `17`
- [x] `getAskEdgarCallCount()` assertion is `1` (unique tickers, not raw calls)
- [x] Rate-limit test expects `10` fetch calls (new batch size)
- [x] Dedup test expects `17` fetch calls (17 endpoints)
- [x] All existing tests still pass

---

### Phase 4: Update Docs

#### Step 9 — Update `docs/AE_API_DOCS.md`

**File:** `docs/AE_API_DOCS.md`
**Action:** MODIFY

Make targeted edits only — do not rewrite the whole file.

**9a. Add rate limits section.** After the "Quick Start" section (after the JavaScript example, before "Common Patterns"), insert:

```markdown
---

## **Rate Limits**

| Limit | Value |
| ----- | ----- |
| Requests per minute | 150 |
| Unique tickers per day | 50 |

If you exceed the per-minute limit, the API returns `429 Too Many Requests` with a `retry_after` value in the error payload. If you exceed the daily ticker limit, requests for new tickers will fail until midnight UTC.
```

**9b. Add `/v1/split-status` endpoint.** Insert as a new section after the existing "Reverse Splits" section (endpoint 1 in the existing docs). Use the existing numbering convention — number it as the next available section.

Content:
```markdown
### **N. Split Status (Reverse Split Tracker)**

**GET** `/v1/split-status`

Track where a company is in the reverse split approval process. Unlike `/v1/reverse-splits` (completed splits), this shows in-progress or recently announced split activity.

**`ticker` is required.**

#### **`action_type` values**

- `Pending Vote` — Vote date set, shareholders haven't voted yet
- `Vote Approved` — Shareholders approved the reverse split
- `Stock Split Announced` — Company announced the effective date

#### **Parameters**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `ticker` | string | **Yes** | Stock ticker |
| `page` | integer | No | Page number (default: `1`) |
| `limit` | integer | No | Results per page (default: `10`) |

#### **Response fields**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `ticker` | string | Stock ticker |
| `action_type` | string | `"Pending Vote"`, `"Vote Approved"`, or `"Stock Split Announced"` |
| `split_from` | number | Original share count in the ratio |
| `split_to` | number | New share count in the ratio |
| `vote_date` | date | Date of the shareholder vote |
| `approved_date` | date | Date the vote was approved |
| `effective_date` | date | Date the split takes effect |
| `details` | string | Description from the filing |
| `filed_at` | date | SEC filing date |
| `form_type` | string | SEC form type |
| `document_url` | string | Link to the SEC filing |
| `last_updated` | datetime | When this record was last refreshed |
```

Replace `N` with the correct section number.

**9c. Add section for unused endpoints.** At the end of the file, add:

```markdown
---

## **Additional Endpoints (Not Yet Integrated)**

The following AskEdgar API endpoints exist but are not currently called by Nexus Terminal. Documented for future reference.

| Endpoint | Description | Generation Trigger |
| -------- | ----------- | ------------------ |
| `GET /v1/ai-chart-analysis` | AI gap analysis for a ticker (ticker required) | Generated at +20% gain |
| `GET /v1/research-reports` | Full AI research report (ticker required) | Generated at +40% gain |
| `GET /v1/research-reports-short` | Short AI report, more sources (ticker required) | 10–15 min after +40% gain |
| `GET /v1/research-reports-tldr` | TLDR version of the AI report (ticker required) | Generated at +40% gain |
| `GET /v1/market-strength` | Daily AI small-cap market analysis | Generated at 2:30 AM CST |

All endpoints use the same `API-KEY` header authentication and the same `{ status, count, results }` response wrapper.
```

**Acceptance criteria:**
- [x] Rate limits section exists and says 150 req/min and 50 unique tickers/day
- [x] `/v1/split-status` is documented with all 12 response fields
- [x] 5 unused endpoints documented in summary table
- [x] No existing endpoint docs removed or rewritten

---

### Files Changed Summary

| File | Action | Risk |
| ---- | ------ | ---- |
| `lib/askedgar.ts` | MODIFY | **MEDIUM** — rate-limit refactor + new endpoint + normalization |
| `lib/types.ts` | MODIFY | LOW — additive interface + one new field |
| `components/trading/ResearchReportSections.tsx` | MODIFY | LOW — additive UI section |
| `__tests__/askedgar-client.test.ts` | MODIFY | LOW — assertion value updates |
| `docs/AE_API_DOCS.md` | MODIFY | LOW — docs only |
| `.env.example` | MODIFY | LOW — comment + default value |

### Order of Operations

Codex must follow this order to avoid TypeScript errors mid-execution:

1. **Step 4** — types first (all other steps depend on this)
2. **Step 5** — import + fetch function + endpoint key + endpoint config
3. **Step 6** — normalization logic
4. **Steps 1 + 2** — rate limit corrections (batch size, daily limit refactor)
5. Run `npm run lint && npx tsc --noEmit` — fix any issues before continuing
6. **Step 7** — UI section
7. **Step 8** — test updates
8. Run `npm run lint && npx tsc --noEmit && npm test` — all must pass
9. **Step 3** — `.env.example`
10. **Step 9** — docs update
11. Final: `npm run lint && npx tsc --noEmit && npm test`

### Verification Steps

```bash
npm run lint          # Must pass
npx tsc --noEmit      # Must pass
npm test              # Must pass — existing tests updated for 17 endpoints
```

**Manual check:** Load a research snapshot in the UI → History tab. If the ticker has split-status data, the new table renders. If not, no new UI appears (hidden when empty).

### Suggested Commit

`feat(askedgar): correct rate limits, add split-status endpoint, update docs`
