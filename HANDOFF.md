# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-30
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Specs

## Build Spec — MDR-Eligibility Filter for "Potential MDR Setup" Scanner

> Generated: 2026-04-30 | Agent: claude (inline)
> Status: IMPLEMENTED 2026-04-30

### Objective

Filter the "Potential MDR Setup" table in `DashboardScannerTable.tsx` so it only displays gainers that meet the structural criteria of a Day-2+ MDR (Multi-Day Runner) continuation pattern. Eligibility is computed from 20 trading days of historical OHLC bars (via Massive `/v2/aggs/ticker`) plus the live mark from the gainers feed. Once a ticker qualifies during a session, eligibility latches for the rest of that trading day even if it pulls back below the threshold.

### Background — the MDR pattern

Adapted from a backtest script (`mdr swing scan.py`) used by other traders. The active filter (`d2_mdr` in that script) requires:

1. **Prior qualifying day in last 20 sessions** — at least one of the previous 20 trading days had: change ≥ 20% AND dollar volume ≥ $100M AND green close (`c > o`) AND broke prior day's high (`h > h[-1]`)
2. **Up ≥3x from 20-day base** — today's mark ≥ 4× the 20-day low (excluding today)
3. **New 20-day high** — today's mark > the highest high of the previous 20 sessions
4. **Today's intraday volume** ≥ 10M shares

Items 1–3 are structural and only need fresh data once per day per ticker. Item 4 changes intraday and is checked from the live gainers feed. Latching means once all four conditions are satisfied during the session, the ticker stays in the MDR table for the rest of the day even if its mark dips below the new-20d-high threshold (the "continuation thesis" doesn't reset on a pullback).

---

## Required Changes

### Change 1 — New helper in `lib/massive-market.ts`

**File:** `lib/massive-market.ts`
**Action:** MODIFY

**Steps:**

1. The existing `fetchDailyAggregates(ticker, days)` function (lines 238–287) returns ascending bars and slices to the most recent `days` entries. It already does what we need. **Do not modify it.**
2. After `fetchDailyAggregates` (after line 287, end of file), append a new exported function:

```typescript
/**
 * MDR-eligibility structural check based on prior 20 trading days plus today's mark.
 *
 * Returns true for `eligible` only when ALL of:
 *   - had a "qualifying day" in the prior 20 sessions
 *     (change >= 20% AND dollar vol >= $100M AND green close AND broke prior high)
 *   - today's mark >= 4x the 20-day low (excluding today)
 *   - today's mark > highest high of the prior 20 sessions
 *
 * Note: "today" means the most recent bar in the returned series. If the most
 * recent bar's date matches today's date in America/New_York, that bar is
 * treated as "today's bar" and excluded from the 20-day lookback.
 */
export interface MdrEligibilityResult {
  ticker: string;
  eligible: boolean;
  hadPriorBigDay: boolean;
  isUp3xFromBase: boolean;
  isNew20dHigh: boolean;
  priorBase20Low: number | null;
  priorHigh20: number | null;
  fetchedAt: string;
}

export async function computeMdrEligibility(
  ticker: string,
  mark: number,
): Promise<MdrEligibilityResult> {
  const fetchedAt = new Date().toISOString();
  const normalizedTicker = ticker.trim().toUpperCase();

  // Pull 25 trading days as buffer; we need 20 prior bars + maybe today's bar.
  const bars = await fetchDailyAggregates(normalizedTicker, 25);

  // Determine "today" in America/New_York. If the most recent bar matches today,
  // treat it as today's bar and slice it off the lookback. Otherwise, all returned
  // bars are prior sessions.
  const todayNY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD

  const lastBar = bars[bars.length - 1];
  const priorBars = lastBar && lastBar.date === todayNY ? bars.slice(0, -1) : bars;

  // Need at least 20 prior bars for a meaningful lookback. If fewer (new IPO,
  // partial history), we conservatively return ineligible.
  if (priorBars.length < 20) {
    return {
      ticker: normalizedTicker,
      eligible: false,
      hadPriorBigDay: false,
      isUp3xFromBase: false,
      isNew20dHigh: false,
      priorBase20Low: null,
      priorHigh20: null,
      fetchedAt,
    };
  }

  const lookback = priorBars.slice(-20); // most recent 20 prior trading days

  // 1. Prior qualifying day check.
  // For each bar i in lookback, we need bar[i-1] for "broke prior high".
  // Build a contiguous index over priorBars and walk pairs.
  let hadPriorBigDay = false;
  for (let i = priorBars.length - 20; i < priorBars.length; i += 1) {
    const bar = priorBars[i];
    const prev = priorBars[i - 1]; // may be undefined for the very first bar
    if (!prev) continue; // can't evaluate "broke prior high" without a predecessor
    const changePct = bar.close / prev.close - 1;
    const dollarVol = bar.close * bar.volume;
    const isGreen = bar.close > bar.open;
    const brokePriorHigh = bar.high > prev.high;
    if (changePct >= 0.2 && dollarVol >= 100_000_000 && isGreen && brokePriorHigh) {
      hadPriorBigDay = true;
      break;
    }
  }

  // 2. Up >=3x from 20-day base. Lookback low excludes today by construction.
  const priorBase20Low = Math.min(...lookback.map((b) => b.low));
  const isUp3xFromBase = priorBase20Low > 0 ? mark / priorBase20Low - 1 >= 3 : false;

  // 3. New 20-day high. Lookback high excludes today by construction.
  const priorHigh20 = Math.max(...lookback.map((b) => b.high));
  const isNew20dHigh = mark > priorHigh20;

  const eligible = hadPriorBigDay && isUp3xFromBase && isNew20dHigh;

  return {
    ticker: normalizedTicker,
    eligible,
    hadPriorBigDay,
    isUp3xFromBase,
    isNew20dHigh,
    priorBase20Low,
    priorHigh20,
    fetchedAt,
  };
}
```

**Acceptance criteria:**
- [x] `computeMdrEligibility` and `MdrEligibilityResult` are exported from `lib/massive-market.ts`
- [x] Function pulls 25 days via `fetchDailyAggregates`, drops "today" if present, requires ≥20 prior bars
- [x] Returns `eligible: false` (with all sub-flags `false` and lows/highs `null`) when prior history is insufficient
- [x] No new imports required — uses existing `fetchDailyAggregates` from same file
- [x] `npx tsc --noEmit` passes

---

### Change 2 — New API route: `/api/scanner/mdr-eligibility`

**File:** `app/api/scanner/mdr-eligibility/route.ts`
**Action:** CREATE

**Steps:**

1. Create the directory `app/api/scanner/mdr-eligibility/` and create `route.ts` with the following content:

```typescript
import { z } from 'zod';
import { internalServerError, logRouteError, TICKER_REGEX } from '@/lib/api-route-utils';
import { requireUser } from '@/lib/server-db-utils';
import { computeMdrEligibility } from '@/lib/massive-market';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .regex(TICKER_REGEX, 'Invalid ticker format')
    .transform((v) => v.trim().toUpperCase()),
  mark: z.coerce.number().positive().finite(),
});

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    ticker: searchParams.get('ticker') ?? '',
    mark: searchParams.get('mark') ?? '',
  });
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const { ticker, mark } = parsed.data;

  try {
    const result = await computeMdrEligibility(ticker, mark);
    return Response.json(result);
  } catch (error) {
    logRouteError('scanner-mdr-eligibility', error);
    return internalServerError();
  }
}
```

**Acceptance criteria:**
- [x] `GET /api/scanner/mdr-eligibility?ticker=AAPL&mark=4.20` returns `{ ticker, eligible, hadPriorBigDay, isUp3xFromBase, isNew20dHigh, priorBase20Low, priorHigh20, fetchedAt }`
- [x] Missing or invalid `ticker` or `mark` returns 400 with `{ error: 'Validation failed', details: { ... } }`
- [x] Unauthenticated request returns 401
- [x] `export const dynamic = 'force-dynamic'` is present

---

### Change 3 — Update `DashboardScannerTable.tsx` with eligibility fetch + latched filter

**File:** `components/trading/DashboardScannerTable.tsx`
**Action:** MODIFY

**Steps:**

1. After the `ScannerSummary` interface (currently ends at line 23), add a new interface:

```typescript
interface MdrEligibility {
  ticker: string;
  eligible: boolean;
  hadPriorBigDay: boolean;
  isUp3xFromBase: boolean;
  isNew20dHigh: boolean;
  priorBase20Low: number | null;
  priorHigh20: number | null;
  fetchedAt: string;
}
```

2. Inside `DashboardScannerTable` (currently at line 69), after the existing `requestedSummariesRef` declaration (line 74), add three new pieces of state for MDR eligibility:

```typescript
  // Tickers that have qualified for MDR during this session, latched until midnight ET.
  // Each entry stores the ET date when it qualified ('YYYY-MM-DD'); the Set of
  // currently-latched tickers is derived from entries whose date matches today.
  const [mdrLatched, setMdrLatched] = useState<Record<string, string>>({});
  // Per-ticker fetch dedupe — the eligibility check is keyed by (ticker, mark), but
  // we only want to *attempt* an eligibility fetch once per ticker per session until
  // we either get an `eligible: true` (latch it) or we re-poll on the next gainers tick.
  const requestedEligibilityRef = useRef(new Set<string>());
```

3. Add a helper for "today in America/New_York" near the top of the component file (above the component, after `fmtMonths`):

```typescript
function todayInNewYork(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD
}
```

4. After the existing `useEffect` that fetches `scanner-summary` (currently ends at line 117), add a NEW `useEffect` that fetches MDR eligibility for each gainer that:
   - Has `volume >= 10_000_000` (intraday volume gate)
   - Is not yet latched as MDR-eligible for today
   - Has not already been requested this gainers tick

```typescript
  useEffect(() => {
    if (gainers.length === 0) return;
    const today = todayInNewYork();

    for (const gainer of gainers) {
      // Already latched as MDR-eligible today — don't re-check.
      if (mdrLatched[gainer.ticker] === today) continue;

      // Intraday volume gate — must be >= 10M shares to even attempt eligibility.
      if (!Number.isFinite(gainer.volume) || gainer.volume < 10_000_000) continue;

      // Dedupe per gainers tick. The Ref is cleared whenever the gainers list reference
      // changes (every 10 seconds), so a non-eligible ticker can be re-checked on the
      // next tick once its mark or volume has moved.
      const key = `${gainer.ticker}:${gainer.price.toFixed(3)}`;
      if (requestedEligibilityRef.current.has(key)) continue;
      requestedEligibilityRef.current.add(key);

      void (async () => {
        try {
          const url = `/api/scanner/mdr-eligibility?ticker=${encodeURIComponent(gainer.ticker)}&mark=${gainer.price}`;
          const res = await fetch(url);
          if (!res.ok) return;
          const data = (await res.json()) as MdrEligibility;
          if (data.eligible) {
            setMdrLatched((prev) => ({ ...prev, [data.ticker]: today }));
          }
        } catch {
          // Leave row out of MDR table on transient failure; will retry on next gainers tick.
        }
      })();
    }
  }, [gainers, mdrLatched]);
```

5. Reset the `requestedEligibilityRef` Set on every gainers list update so non-eligible tickers can be retried after their mark/volume moves. Modify the existing `fetchGainers` callback (currently lines 76–91) — at the end of the success path (after `setIsRealtime(...)`), add:

```typescript
      requestedEligibilityRef.current = new Set();
```

The full updated callback:

```typescript
  const fetchGainers = useCallback(async () => {
    try {
      const res = await fetch('/api/tradingview/gainers');
      if (!res.ok) return;
      const data = (await res.json()) as {
        gainers: TradingViewGainer[];
        isRealtime: boolean;
      };
      setGainers(data.gainers ?? []);
      setIsRealtime(data.isRealtime ?? false);
      requestedEligibilityRef.current = new Set();
    } catch {
      // Keep the last good scanner rows on transient polling failures.
    } finally {
      setLoading(false);
    }
  }, []);
```

6. In the JSX for the "Potential MDR Setup" table (currently the second `{gainers.map(...)}` block starting around line 265), filter the gainers list to only latched-eligible tickers. Replace `gainers.map((gainer) => {` with:

```typescript
              {(() => {
                const today = todayInNewYork();
                const mdrGainers = gainers.filter((g) => mdrLatched[g.ticker] === today);

                if (mdrGainers.length === 0) {
                  return (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-zinc-500">
                        No MDR setups detected.
                      </td>
                    </tr>
                  );
                }

                return mdrGainers.map((gainer) => {
```

And close the IIFE properly. The closing of the existing map looks like this:

```typescript
                );
              })}
            </tbody>
```

Change it to:

```typescript
                );
                });
              })()}
            </tbody>
```

(The `})` closes the inner `.map(...)` callback, the `)` closes the `.map(...)` call, the `;` ends the return statement, the `})` closes the IIFE arrow body, the `()` invokes it.)

**Acceptance criteria:**
- [x] New `MdrEligibility` interface declared
- [x] `mdrLatched` state (`Record<string, string>` mapping ticker → ET date when qualified) added
- [x] `requestedEligibilityRef` reset every time gainers list refreshes
- [x] New useEffect fires `/api/scanner/mdr-eligibility?ticker=X&mark=Y` for each gainer with volume ≥ 10M that isn't already latched today
- [x] Eligibility persists for the rest of the ET day once a ticker qualifies (latched)
- [x] "Potential MDR Setup" table renders ONLY latched tickers; empty state shown when none
- [x] All other "Gainers Scan — Day 1 Setup" behavior unchanged
- [x] PM Price Needed / Opening Gap Needed / Intraday Price Needed columns still render `—` (next handoff)
- [x] `npm run lint` passes
- [x] `npx tsc --noEmit` passes

---

### Change 4 — Test for the new API route

**File:** `__tests__/scanner-mdr-eligibility-route.test.ts`
**Action:** CREATE

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  computeMdrEligibilityMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  computeMdrEligibilityMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/massive-market', () => ({
  computeMdrEligibility: computeMdrEligibilityMock,
}));

import { GET } from '@/app/api/scanner/mdr-eligibility/route';

function makeRequest(ticker?: string, mark?: string): Request {
  const params = new URLSearchParams();
  if (ticker !== undefined) params.set('ticker', ticker);
  if (mark !== undefined) params.set('mark', mark);
  const qs = params.toString();
  return new Request(`http://localhost/api/scanner/mdr-eligibility${qs ? `?${qs}` : ''}`);
}

function authedUser() {
  requireUserMock.mockResolvedValue({
    user: { id: 'user-1', email: 'test@example.com', name: 'Test', picture: null },
  });
}

describe('GET /api/scanner/mdr-eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    requireUserMock.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await GET(makeRequest('AAPL', '100'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when ticker is missing', async () => {
    authedUser();
    const res = await GET(makeRequest(undefined, '100'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when mark is missing', async () => {
    authedUser();
    const res = await GET(makeRequest('AAPL'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when mark is not a positive number', async () => {
    authedUser();
    const res = await GET(makeRequest('AAPL', '-1'));
    expect(res.status).toBe(400);
  });

  it('returns eligibility result for a valid ticker', async () => {
    authedUser();
    const mockResult = {
      ticker: 'ACME',
      eligible: true,
      hadPriorBigDay: true,
      isUp3xFromBase: true,
      isNew20dHigh: true,
      priorBase20Low: 1.0,
      priorHigh20: 4.5,
      fetchedAt: '2026-04-30T00:00:00.000Z',
    };
    computeMdrEligibilityMock.mockResolvedValue(mockResult);

    const res = await GET(makeRequest('acme', '5.00'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(computeMdrEligibilityMock).toHaveBeenCalledWith('ACME', 5.0);
    expect(body).toEqual(mockResult);
  });

  it('returns 500 when computeMdrEligibility throws', async () => {
    authedUser();
    computeMdrEligibilityMock.mockRejectedValue(new Error('Massive down'));
    const res = await GET(makeRequest('AAPL', '100'));
    expect(res.status).toBe(500);
  });
});
```

**Acceptance criteria:**
- [x] All 6 test cases pass: `npm test -- __tests__/scanner-mdr-eligibility-route.test.ts`
- [x] Mocking pattern matches `__tests__/scanner-summary-route.test.ts`

---

## Files Changed Summary

| File | Action | Est. lines added / removed | Risk |
|------|--------|---------------------------|------|
| `lib/massive-market.ts` | MODIFY (append) | +95 added / 0 removed | LOW |
| `app/api/scanner/mdr-eligibility/route.ts` | CREATE | +45 | LOW |
| `components/trading/DashboardScannerTable.tsx` | MODIFY | +60 added / ~10 changed | MED |
| `__tests__/scanner-mdr-eligibility-route.test.ts` | CREATE | +95 | LOW |

---

## Order of Operations

1. `lib/massive-market.ts` — append `computeMdrEligibility`. Run `npx tsc --noEmit`.
2. `app/api/scanner/mdr-eligibility/route.ts` — create the route. Run `npx tsc --noEmit`.
3. `__tests__/scanner-mdr-eligibility-route.test.ts` — create the test. Run `npm test -- __tests__/scanner-mdr-eligibility-route.test.ts`.
4. `components/trading/DashboardScannerTable.tsx` — wire the eligibility fetch + latched filter into the existing component.
5. Run full validation suite.

---

## Verification Steps

### Commands

```bash
npm run lint
npx tsc --noEmit
npm test
```

All three must pass with 0 errors.

### Manual UI checks

1. **Dashboard tab loads** — top "Gainers Scan — Day 1 Setup" table is unchanged. Bottom "Potential MDR Setup" table now shows "No MDR setups detected" if no gainer qualifies.
2. **Eligibility latches** — pick a ticker that qualifies (or temporarily lower thresholds in `computeMdrEligibility` to force a hit). It should appear in the MDR table within ~10 seconds (next gainers tick).
3. **Latch persists on pullback** — once a ticker is in the MDR table, manually verify (via React DevTools or by editing `mdrLatched` state) that it stays in the table even if its mark drops below the 20-day high. Latch only clears on a new ET date.
4. **Volume gate** — a ticker with < 10M intraday volume never makes the eligibility request (verify via Network tab).
5. **Fresh ticker (low history) safe** — a recently-IPO'd ticker (< 20 prior trading days) returns `eligible: false` without throwing.
6. **Row click still works** — clicking a row in the MDR table opens that ticker in Research, same as the top table.

---

## Security Considerations

- The new `/api/scanner/mdr-eligibility` route is guarded by `requireUser()`. No unauthenticated access.
- `ticker` is validated against `TICKER_REGEX` before fetch.
- `mark` is coerced to a positive finite number — no injection vector into the Massive URL.
- `MASSIVE_API_KEY` stays server-side; the helper is called only from the server route.

## Rollback Plan

All changes are additive or self-contained. Git revert restores previous behavior. No schema migrations.

## Complexity Estimate

**LOW–MED** — 4 files touched, 1 new API route, 1 small library helper, 1 component wire-up. Estimated wall-clock for Codex: 45–75 minutes including lint/typecheck cycles.

---

## Open Blockers / Follow-Ups

- **Backtesting drawings still don't render (2026-04-28).** Refactor work captured the `armedAction`/`onArmedClick`/`onAnchorChange` callbacks in refs and memoized `handleArmedClick`; execution arrows + stop line render fine, but user-drawn trendlines/horizontals/rectangles still don't appear. Suspect canvas overlay sizing (parent `clientWidth/Height` is 0 on first mount) or pointer-events stealing clicks before `chart.subscribeClick` fires. Investigate by adding console logs in `ChartDrawings.tsx:212` (handleClick), `ChartDrawings.tsx:289` (handleCrosshairMove), `ChartDrawings.tsx:405` (renderDrawings) and inspecting the canvas DOM rect in DevTools.
- **AskEdgar Sprint 3 Part B (`split-status`) — PARKED.** Researched + planned 2026-04-29; full design captured in auto-memory `project_split_status_research.md`. Pending endpoint-usage audit before commit. Reusable artifacts: state machine design (4 states), source precedence, section-locator approach for DEF 14A.
- **Endpoint review pending (2026-04-29).** Future scrutiny: `screener`, `ownership`, `nasdaq-compliance`; `historical-float-pro`, `float-outstanding` (review payload). `split-status` parked separately.
- **Sprint 4 — `screener` removal deferred.** Per-ticker `/v1/screener` feeds 9 header fields (`marketCap`, `outstandingShares`, `float`, `exchange`, `ipoDate`, `industry`, `country`, `shortInterest`, `volume`) in `normalizeAskEdgarResponse` (`lib/askedgar.ts:972-986`). Removing without a replacement breaks the Research card header. `getCachedGainers` / `fetchTopGainers` use the same `/v1/screener` endpoint with different params and stay independent. Plan a header-fields replacement (companyfacts gives shares-out, market cap needs price * shares, exchange/industry possibly from `sec_ticker_cik`) before removing.
- **Filings v2 (deferred) — in-app viewer.** AskEdgar-style filing reader (iframe of the SEC primary document with Exhibits sidebar from `<accession>/index.json`, browser-native Ctrl+F inside the iframe). ~1-2 days. Defer until we have user feedback on the click-out flow.
- **Filings v3 (deferred) — full-text search + AI Copilot.** "Search in Documents" across all filings for a ticker requires Postgres `tsvector` ingestion or external index. AI Copilot panel (Summarize / Key Points / Catalysts) plumbs into existing agent infra. Cost analysis required first.
- **Auto stop-out for Backtesting (deferred).** When intraday bar prints through a stop, simulator should auto-execute SELL/COVER. Schema supports it. UI: settings toggle defaulting OFF for parity. Add when user requests.
- **Sprint 4 follow-up — extended `OfferingType` union.** v1 intentionally excludes DEBT OFFERING / DEBT CONVERSION / CREDIT FACILITY / SHARE ISSUANCE FOR ACQUISITION / UPLIST. Add if real filings exercise them. Revisit if blueprints start filtering by type.
- **AskEdgar paid API key.** `https://eapi.askedgar.io` remains the correct base URL. Only swap `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles`, Sprint 2 dropped `historical-float-pro`, Sprint 3 Part A dropped `reverse-splits`, Sprint 4 drops `offerings` + `pump-and-dump-tracker` from AskEdgar fan-out. Track via `[askedgar-fanout]` log's `costUsd` token.
- **MDR setup — entry-trigger columns (deferred to next handoff).** PM Price Needed / Opening Gap Needed / Intraday Price Needed currently render `—`. Will be filled in once Jared reverse-engineers entry triggers from his friends' trade list. Will also load qualifying tickers into Backtesting tab.
