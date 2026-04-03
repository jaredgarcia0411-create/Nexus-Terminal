# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

### Session Maintenance Checklist

- [x] Review `AGENTIC_EXPANSIONV2.md` and replace `AEV2_REVISIONS.md` with a literal pre-sprint edit script for the next spec pass
- [x] Apply `AEV2_REVISIONS.md` to `AGENTIC_EXPANSIONV2.md` and rename the spec file from `AGENTIC_EXPANSION_V2.md`
- [x] Run the post-patch cleanup sweep on `AGENTIC_EXPANSIONV2.md`
- [x] Refresh `AEV2_REVISIONS.md` with sprint-board blockers, launch blockers, and locked routing/service-route decisions from the latest review
- [x] Convert `AEV2_REVISIONS.md` from redline checklist into a literal section-by-section patch plan for the next spec pass
- [x] **Execute R6 consolidation pass on AGENTIC_EXPANSIONV2.md** (this handoff)
- [x] Draft a tight pre-sprint blocker patch checklist in `HANDOFF.md` from the latest AGENTIC_EXPANSIONV2 review
- [x] Expand the blocker checklist into an exact section-by-section patch plan with replacement targets
- [x] Execute the pre-sprint blocker patch plan on `AGENTIC_EXPANSIONV2.md`
- [x] Draft `AEV2_DRAFT.md` with initiative/epic/story/sprint breakdown for `AGENTIC_EXPANSIONV2.md`

---

# Build Spec — Codebase Cleanup

> Generated: 2026-04-03 | Status: READY TO EXECUTE
> Pure refactor — no behavior changes, no new user-visible features.
> Items grouped by risk and dependency order.

## Execution Order

```
Group 1 (parallel): Steps 1-5  → validate → STOP & COMMIT
Group 2 (parallel): Steps 6-10 → validate → STOP & COMMIT
Group 3 (sequenced): Step 11 → Step 12 (12a→12b→12c→12d→12e→12f) → validate → STOP & COMMIT
Step 13: HANDOFF.md cleanup
```

---

## Group 1: Quick Wins

**Status:** complete

Delivered:
- Memoized `PerformanceTab` symbol distribution so the aggregation no longer runs inline on every render.
- Removed dead `RESEARCH_SCHEMA` / `buildResearchPrompt` from `lib/jarvis/prompts.ts`.
- Moved pure trade helpers from `hooks/trade-utils.ts` to `lib/trade-utils.ts` and updated imports.
- Removed obsolete trade migration / DB-availability fallback code and deleted `lib/trade-migration.ts`, `lib/storage.ts`, and `__tests__/trade-migration.test.ts`.
- Verified the old unchecked `Update AGENTS.md` item is not present.
- Updated `__tests__/markets-tab.test.tsx` to match the current Markets tab render during validation.

Validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

### ⛔ STOP — Commit Group 1 before proceeding to Group 2.

---

## Group 2: Medium Complexity (run in parallel)

**Status:** complete

Delivered:
- Centralized `TradeMarker` in `lib/types.ts`, re-exported it from `CandlestickChart.tsx`, and moved shared marker construction into `buildTradeMarkers()`.
- Moved duplicated timeframe config/type definitions into `lib/chart-timeframes.ts` for `ChartsTab` and `ResearchChart`.
- Fixed `use-scanner.ts` so the initial mount only performs one results fetch instead of double-firing.
- Split `/api/market-data/snapshot` provider logic into `lib/massive-snapshot.ts` and `lib/realtime-snapshot.ts`; route is now under 250 lines.
- Merged Jarvis chat + stream handling into `/api/jarvis/chat`, deleted `/api/jarvis/chat/stream`, and updated the client to use `?stream=1`.

Validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] Targeted regression coverage passed: `__tests__/jarvis-chat-route.test.ts`, `__tests__/jarvis-chat-stream-route.test.ts`, `__tests__/market-data-snapshot-route.test.ts`, `__tests__/markets-tab.test.tsx`

---

## Group 3: AskEdgar (sequenced — Step 11 before Step 12)

**Status:** implementation complete — live Research tab visual verification still pending.

### Step 11 — Extract AskEdgar shared helpers to `lib/askedgar-utils.ts`

**Background:** Three components define `AskEdgarEndpointResponse` and `getField()` independently:
- `ResearchReportSections.tsx` (950 lines): defines `AskEdgarEndpointResponse`, `isRecord`, `toRecord`, `toNumberValue`, `formatNumber`, `formatMoney`, `getField`, `riskClass` (lines 5-118)
- `ResearchCompanyHeader.tsx`: defines `AskEdgarEndpointResponse` (lines 3-7), `toRecord` (15-17), `getField` (19-26)
- `ResearchTickerView.tsx`: defines `AskEdgarEndpointResponse` (lines 10-14)

**Files affected:**
- `lib/askedgar-utils.ts` — CREATE
- `components/trading/ResearchReportSections.tsx` — MODIFY
- `components/trading/ResearchCompanyHeader.tsx` — MODIFY
- `components/trading/ResearchTickerView.tsx` — MODIFY

**What to do:**

**11a. Create `lib/askedgar-utils.ts`:**

```ts
// Client-safe utilities for AskEdgar API response handling.
// No server-only imports — safe to use in client components.

export interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%]/g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Looks up the first non-null, non-empty value among the given keys in a record.
// AskEdgar uses inconsistent snake_case vs camelCase — this handles both.
export function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

export function formatNumber(value: unknown): string {
  const numeric = toNumberValue(value);
  return numeric === null ? 'N/A' : numeric.toLocaleString();
}

export function formatMoney(value: unknown): string {
  const numeric = toNumberValue(value);
  if (numeric === null) return 'N/A';
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Returns Tailwind CSS classes for a dilution risk rating.
// Low/Compliant/Positive → emerald. Medium/Watch → amber. High/Risk/Non-compliant → rose.
export function riskClass(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('low') || normalized.includes('compliant') || normalized.includes('positive')) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (normalized.includes('medium') || normalized.includes('watch') || normalized.includes('warning')) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  if (normalized.includes('high') || normalized.includes('risk') || normalized.includes('non-compliant') || normalized.includes('negative')) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
}
```

**11b. In `components/trading/ResearchReportSections.tsx`:**

Add at the top (line 3):
```ts
import {
  AskEdgarEndpointResponse,
  formatMoney,
  formatNumber,
  getField,
  isRecord,
  riskClass,
  toNumberValue,
  toRecord,
} from '@/lib/askedgar-utils';
```

Delete lines 5-9 (`interface AskEdgarEndpointResponse`).
Delete the following function definitions (verify exact lines before deleting):
- `isRecord` (~line 25)
- `toRecord` (~line 29)
- `toStringValue` (~line 33) — check if still used locally. If yes, keep it. If no, delete.
- `toNumberValue` (~line 40)
- `formatNumber` (~line 49)
- `formatMoney` (~line 54)
- `getField` (~line 67)
- `riskClass` (~line 106)

Keep all other local functions: `formatDate`, `detectFormType`, `babyShelfBadge`, `endpoint`, `hasData`, `NoDataBadge`, `isWarrantRow` (if present), and the rest of the component.

**11c. In `components/trading/ResearchCompanyHeader.tsx`:**

Add import (line 1, after `'use client'`):
```ts
import { AskEdgarEndpointResponse, getField, toRecord } from '@/lib/askedgar-utils';
```

Delete lines 3-7 (`interface AskEdgarEndpointResponse`).
Delete lines 15-17 (`toRecord` function).
Delete lines 19-26 (`getField` function).
Keep `formatCompact` — it is unique to this component.

**11d. In `components/trading/ResearchTickerView.tsx`:**

Add import:
```ts
import type { AskEdgarEndpointResponse } from '@/lib/askedgar-utils';
```

Delete lines 10-14 (local `interface AskEdgarEndpointResponse`).
Keep `AskEdgarLookupData` interface — it is specific to this component.

**Acceptance Criteria:**
- [x] `lib/askedgar-utils.ts` exists with all listed exports
- [x] `ResearchReportSections.tsx`: no local definitions of `AskEdgarEndpointResponse`, `isRecord`, `toRecord`, `toNumberValue`, `formatNumber`, `formatMoney`, `getField`, `riskClass`
- [x] `ResearchCompanyHeader.tsx`: no local definitions of `AskEdgarEndpointResponse`, `toRecord`, `getField`
- [x] `ResearchTickerView.tsx` no longer owns a local AskEdgar response interface
- [ ] Research tab renders identically
- [x] `npx tsc --noEmit` passes

---

### Step 12 — Normalize AskEdgar data server-side (Deferred Item 1)

**Complexity: HIGH. Do not start without completing Step 11 first.**

**Background:** `/api/askedgar/lookup` returns raw AskEdgar data verbatim. All field normalization — `getField(['snake_case', 'camelCase'])` fallbacks, equity line deduplication, warrant classification, baby shelf logic — happens in `ResearchReportSections.tsx` (950 lines). Moving this to the server creates a `ResearchSnapshot` normalized shape and reduces the component to render-only JSX (~600 lines).

**Files:**
- `lib/types.ts` — MODIFY (add `ResearchSnapshot` + sub-types)
- `lib/jarvis/askedgar.ts` — MODIFY (add `normalizeAskEdgarResponse()`)
- `app/api/askedgar/snapshot/route.ts` — CREATE (new endpoint returning normalized shape)
- `components/trading/ResearchTickerView.tsx` — MODIFY (call `/api/askedgar/snapshot`)
- `components/trading/ResearchReportSections.tsx` — MODIFY (receive normalized data, strip transform logic)
- `components/trading/ResearchCompanyHeader.tsx` — MODIFY (receive `header` object instead of `rawData`)
- `.claude/CLAUDE.md` — MODIFY (route count 31 → 32)

**Step 12a — Define `ResearchSnapshot` in `lib/types.ts`**

Add at the bottom of `lib/types.ts`:

```ts
// Normalized server-side shape returned by /api/askedgar/snapshot.
// All field resolution (snake_case/camelCase, equity dedup, warrant classification)
// is done server-side in normalizeAskEdgarResponse().

export interface ResearchSnapshotHeader {
  marketCap: number | null;
  outstandingShares: number | null;
  float: number | null;
  exchange: string | null;
  ipoDate: string | null;
  industry: string | null;
  country: string | null;
}

export interface ResearchSnapshotWarrant {
  details: string;
  amount: number | null;
  remaining: number | null;
  exercisePrice: number | null;
  registered: string | null;
  exercisableDate: string | null;
  expirationDate: string | null;
  filedAt: string | null;
}

export interface ResearchSnapshotRegistration {
  headline: string;
  filedAt: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  isEffective: boolean;
  offeringAmount: number | null;
  isAtm: boolean;
  bank: string | null;
  amountRemainingAtm: number | null;
  totalRaised: number | null;
  overBabyShelf: boolean;
  formType: string | null;
}

export interface ResearchSnapshotOffering {
  headline: string;
  filedAt: string | null;
  offeringType: string | null;
  sharesAmount: number | null;
  warrantsAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
}

export interface ResearchSnapshotNewsItem {
  title: string;
  summary: string;
  filedAt: string | null;
  formType: string | null;
  isNews: boolean;
}

export interface ResearchSnapshot {
  ticker: string;
  fetchedAt: string;
  companyName: string | null;
  warnings: string[];
  header: ResearchSnapshotHeader;
  dilutionRating: string | null;
  cashNeedRating: string | null;
  offeringFrequencyRating: string | null;
  offeringAbilityRating: string | null;
  overallRisk: string | null;
  regsho: boolean;
  nasdaqCompliance: string | null;
  warrants: ResearchSnapshotWarrant[];
  registrations: ResearchSnapshotRegistration[];
  offerings: ResearchSnapshotOffering[];
  news: ResearchSnapshotNewsItem[];
  // rawData preserved for any sections not yet fully normalized
  rawData: Record<string, { status: string; results: unknown[]; error?: string }>;
}
```

**Step 12b — Add `normalizeAskEdgarResponse()` to `lib/jarvis/askedgar.ts`**

This function takes `rawData: Record<string, AskEdgarResponse<unknown>>` and options `{ ticker, companyName, fetchedAt, warnings }`, and returns a `ResearchSnapshot`.

The implementation must port the following logic from `ResearchReportSections.tsx`:
- `screener` key → `header` fields (using `getField` with known key variants)
- `warrants` key → `warrants[]` array
- `offering_ability` / `offeringAbility` key → `registrations[]` (with equity dedup: skip rows where headline contains "equity line"; include warrant rows separately)
- `offerings` key → `offerings[]` (deduplicated by headline)
- `news` + `filings` keys → `news[]`
- Rating extraction from relevant endpoints
- `regsho`, `nasdaqCompliance` from compliance data

Import `getField`, `toRecord`, `toNumberValue` from `@/lib/askedgar-utils` (after Step 11 created it).

**Step 12c — Create `app/api/askedgar/snapshot/route.ts`**

```ts
import { normalizeTicker, TICKER_REGEX, internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getCachedTickerData, normalizeAskEdgarResponse } from '@/lib/jarvis/askedgar';
import { fetchUnifiedSnapshot } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const url = new URL(request.url);
  const ticker = normalizeTicker(url.searchParams.get('ticker') ?? undefined);

  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return Response.json({ error: 'Valid ticker parameter required' }, { status: 400 });
  }

  try {
    const [result, snapshot] = await Promise.all([
      getCachedTickerData(ticker),
      fetchUnifiedSnapshot([ticker]).catch(() => ({ results: [] as unknown[] })),
    ]);

    const companyName =
      (snapshot.results?.[0] as Record<string, unknown> | undefined)?.name as string | undefined ?? null;

    const normalized = normalizeAskEdgarResponse(result.rawData, {
      ticker,
      companyName,
      fetchedAt: result.fetchedAt,
      warnings: result.warnings,
    });

    return Response.json(normalized);
  } catch (error) {
    logRouteError('askedgar-snapshot', error);
    return internalServerError();
  }
}
```

**Step 12d — Update `ResearchTickerView.tsx`**

- Import `ResearchSnapshot` from `@/lib/types`
- Change fetch URL from `/api/askedgar/lookup?ticker=...` to `/api/askedgar/snapshot?ticker=...`
- Update the `data` state type from `AskEdgarLookupData` to `ResearchSnapshot`
- Update props passed to child components:
  - `ResearchCompanyHeader`: pass `header={data.header}` instead of `rawData={data.rawData}`
  - `ResearchReportSections`: pass `data={data}` instead of `rawData={data.rawData}`
- Remove `AskEdgarLookupData` interface (replaced by `ResearchSnapshot` from lib/types)

**Step 12e — Update `ResearchReportSections.tsx`**

- Change props from `{ ticker, rawData: Record<string, AskEdgarEndpointResponse> }` to `{ ticker, data: ResearchSnapshot }`
- Replace all `getField(...)`, `endpoint(rawData, ...)`, `hasData(...)` calls with direct field access on `data.*`
- The tab rendering logic (tabs, layout, colors) stays unchanged
- Target line count: ~600 (down from 950)
- Keep any remaining render-only helper functions (`formatDate`, `babyShelfBadge`, `detectFormType`) that operate on already-normalized data

**Step 12f — Update `ResearchCompanyHeader.tsx`**

- Change props from `{ ticker, rawData, companyName }` to `{ ticker, companyName, header: ResearchSnapshotHeader }`
- Import `ResearchSnapshotHeader` from `@/lib/types`
- Replace `getField(screener, [...])` calls with direct field access on `header.*`
- Remove `firstResult`, `getField`, `toRecord` usages entirely
- `formatCompact` stays (still needed for display formatting)

**Step 12g — Update `.claude/CLAUDE.md`**

Change route count from 31 to 32 (new `/api/askedgar/snapshot` route added).

**Acceptance Criteria:**
- [x] `app/api/askedgar/snapshot/route.ts` exists and returns `ResearchSnapshot` shape
- [x] `ResearchTickerView.tsx` calls `/api/askedgar/snapshot` instead of `/api/askedgar/lookup`
- [x] `ResearchReportSections.tsx` is under 650 lines
- [x] `ResearchReportSections.tsx` no longer calls `getField()` or `endpoint()` (or < 5 remaining for edge cases)
- [x] `ResearchCompanyHeader.tsx` no longer calls `getField()`
- [ ] Research tab renders identically for a real ticker (MARA, AAPL, etc.)
- [x] `npx tsc --noEmit` passes
- [x] CLAUDE.md route count updated to 32

---

### Group 3 Validation

```bash
npm run lint && npx tsc --noEmit
```

Automated validation completed:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

Then open the Research tab, look up a ticker, verify all sections display correctly.

### ⛔ STOP — Commit Group 3 before proceeding to Step 13.

---

## Step 13 — Final HANDOFF.md Cleanup

After all steps above complete:

**File:** `HANDOFF.md`
**Action:** REWRITE

Replace this entire spec with a clean HANDOFF.md containing only:
1. The Session Maintenance Checklist (with `- [x] Execute codebase cleanup spec` added)
2. The `## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)` section (preserved below — explicitly out of scope)

Target: HANDOFF.md under 40 lines.

---

## Files Affected Summary

| File | Action | Risk |
|------|--------|------|
| `components/trading/PerformanceTab.tsx` | MODIFY | LOW |
| `lib/jarvis/prompts.ts` | MODIFY | LOW |
| `hooks/trade-utils.ts` | DELETE | LOW |
| `lib/trade-utils.ts` | CREATE | LOW |
| `hooks/use-trade-sync.ts` | MODIFY | MEDIUM |
| `hooks/use-trades.ts` | MODIFY (import only) | LOW |
| `lib/trade-migration.ts` | DELETE | LOW |
| `lib/storage.ts` | DELETE | LOW |
| `__tests__/trade-migration.test.ts` | DELETE | LOW |
| `HANDOFF.md` | MODIFY | LOW |
| `lib/types.ts` | MODIFY (add TradeMarker + ResearchSnapshot) | MEDIUM |
| `lib/trading-utils.ts` | MODIFY (add buildTradeMarkers) | MEDIUM |
| `components/trading/CandlestickChart.tsx` | MODIFY (re-export TradeMarker) | LOW |
| `components/trading/JournalTradeChart.tsx` | MODIFY | LOW |
| `components/trading/TradeDetailSheet.tsx` | MODIFY | LOW |
| `lib/chart-timeframes.ts` | MODIFY | LOW |
| `components/trading/ChartsTab.tsx` | MODIFY | LOW |
| `components/trading/ResearchChart.tsx` | MODIFY | LOW |
| `hooks/use-scanner.ts` | MODIFY | LOW |
| `lib/massive-snapshot.ts` | CREATE | MEDIUM |
| `lib/realtime-snapshot.ts` | CREATE | MEDIUM |
| `app/api/market-data/snapshot/route.ts` | MODIFY | MEDIUM |
| `app/api/jarvis/chat/route.ts` | MODIFY | MEDIUM |
| `app/api/jarvis/chat/stream/route.ts` | DELETE | LOW |
| `components/trading/JarvisChat.tsx` | MODIFY (1 line) | LOW |
| `lib/askedgar-utils.ts` | CREATE | LOW |
| `components/trading/ResearchReportSections.tsx` | MODIFY | LOW-MEDIUM |
| `components/trading/ResearchCompanyHeader.tsx` | MODIFY | LOW |
| `components/trading/ResearchTickerView.tsx` | MODIFY | LOW |
| `lib/jarvis/askedgar.ts` | MODIFY (add normalizer) | HIGH |
| `app/api/askedgar/snapshot/route.ts` | CREATE | MEDIUM |
| `.claude/CLAUDE.md` | MODIFY (route counts) | LOW |

---

## Security Considerations

- **Step 4:** Removing the localStorage fallback is intentional and safe. If the DB is unavailable, users see an error — they do not silently get stale/empty local data.
- **Step 10:** Merged Jarvis route still calls `requireUser()` as the first operation. No auth bypass possible.
- **Step 11/12:** `lib/askedgar-utils.ts` must not import `process.env` or server-only modules. The `ASKEDGAR_API_KEY` stays in `lib/jarvis/askedgar.ts` (server-only). The new `/api/askedgar/snapshot` endpoint calls `requireUser()`.

---

## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)

These are minor issues found during the 2026-03-29 spec review. None block sprint import, but should be cleaned up when convenient.

- **R8 — `step_log` guidance stated twice.** Line ~822 repeats the same `step_log` content rules from Section 3.2. Replace with a cross-reference: "See Section 3.2 for `step_log` content rules."
- **R9 — "Multi-agent fanout deferred to V2" stated 4 times.** Keep in Executive Summary + Section 13 closing note. Trim the other two instances (Section 6.1 ~line 557 and Section 13 ~line 1649) to short cross-references.
- **R10 — Polling timeout (120s/60 attempts) stated twice.** Section 20 Discord Adapter should reference Section 13 for timeout details instead of restating them.
- **M2 — Budget is per-agent but env var name doesn't clarify.** Add note to Section 19: "Each agent enforces its own budget independently — $5/day default means $15/day total across 3 agents."
- **M3 — `swing:research` step 6 missing `idempotencyKey`.** Add `idempotencyKey: 'swing-research-{ticker}-{date}'` to the metadata.
- **M4 — `getDb()` vs `getAgentDb()` distinction never stated.** Add note: "Vercel routes use `getDb()` from `lib/server-db-utils.ts` (HTTP client). Docker agent workers use `getAgentDb()` from `lib/agents/db.ts` (WebSocket pool). Never mix them."
- **B11 — Two `lib/jarvis/` files missing from Phase 7 delete list.** Add `chat-helpers.ts` and `historical-summary.ts` to the Phase 7 delete list in Section 18.
- **B15 — `services/discord-bot/` already exists with a `dist/` directory.** Audit existing contents before Phase 5 Step 44 — the spec treats it as a fresh creation but files may already be there.
- **B18 — `services/.env.example` contents never specified.** Generate from Docker Compose `environment:` blocks or include a template in Section 15.
