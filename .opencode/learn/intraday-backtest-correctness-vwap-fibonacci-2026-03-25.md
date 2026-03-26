# Intraday Backtest Correctness: Session VWAP + Fibonacci Crash Course
**Researched**: 2026-03-25
**Sources**: NYSE, Nasdaq, Alpaca docs, TradingView docs, Fidelity, codebase analysis
**Context**: 5-minute US equities backtests using session VWAP and Fibonacci levels

---

## Concept Overview
For a 5-minute intraday backtest, the hard part is not computing indicators; it is matching the market's actual session boundaries, bar semantics, and information timing. Session VWAP is only correct if it resets on the exact intended session boundary and accumulates only the intended bars, while Fibonacci is only backtestable if its anchor-selection rule is fully objective and non-discretionary.

## How It Works
Session VWAP is a cumulative ratio: sum(price source x volume) / sum(volume), reset at a defined anchor period. TradingView's VWAP docs explicitly describe cumulative price-volume and cumulative volume, and note that with `Session` anchoring the calculation resets each session. Their docs also note VWAP is primarily intraday and that higher-timeframe anchoring must be handled carefully.

For US equities, official exchange hours are in Eastern Time. NYSE lists core trading as 9:30 a.m. to 4:00 p.m. ET, with early/late sessions depending on venue. Nasdaq lists core trading as 9:30 a.m. to 4:00 p.m. ET and extended hours as 4:00 a.m. to 9:30 a.m. ET and 4:00 p.m. to 8:00 p.m. ET. That means a backtest must decide whether its "session" means regular-hours only or extended-hours included, then keep that choice consistent in data loading, VWAP resets, and signal rules.

Fibonacci retracement is not an autonomous indicator. Fidelity defines it as lines drawn after first selecting two extreme points and then applying retracement percentages to the price range between them. So in a backtest, the real requirement is not just the level math; it is an objective rule for choosing those two anchors without hindsight.

## How It Applies Here
In this repo, `lib/indicators.ts` computes VWAP as a single cumulative series over all provided candles and does not reset per session, so it is chart-correct only if the input array is already one session wide. `components/trading/ChartsTab.tsx` feeds `sortedCandles` directly into `vwap()`, which means correctness depends on upstream segmentation. `lib/time-utils.ts` already uses `America/New_York`, which is the right foundation for DST-safe US equities session handling. `lib/massive-market.ts` and `app/api/market-data/snapshot/route.ts` already distinguish `pre-market`, `regular`, and `after-hours`, which matches the research requirement that session identity be explicit, not inferred from close price alone. `components/trading/plugins/FibonacciPrimitive.ts` correctly treats Fibonacci as levels derived from two endpoints, but a backtest engine still needs rules for how those endpoints are picked.

## Codebase Evidence
- `lib/indicators.ts:101`: VWAP is cumulative across the provided candle array; no built-in daily/session reset exists.
- `components/trading/ChartsTab.tsx:422`: chart VWAP uses the loaded candle window as-is, so upstream session segmentation controls correctness.
- `lib/time-utils.ts:5`: uses `America/New_York`, which is the correct IANA timezone for US equities session math.
- `lib/time-utils.ts:147`: session window helper uses 04:00 to 20:00 New York time for intraday data windows.
- `lib/massive-market.ts:79`: session classification is already explicit (`pre-market`, `regular`, `after-hours`, `closed`).
- `components/trading/plugins/FibonacciPrimitive.ts:105`: Fibonacci price levels are pure math from start/end anchors; anchor selection is external.

## Code Examples

### Basic Usage
```ts
type SessionKind = 'regular' | 'extended';

function computeSessionVwap(bars: Array<{
  ts: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sessionDate: string; // NY trading date
  segment: 'pre' | 'regular' | 'post';
}>, sessionKind: SessionKind) {
  let sumPv = 0;
  let sumV = 0;
  let currentKey: string | null = null;

  return bars.map((bar) => {
    const include = sessionKind === 'extended'
      ? bar.segment !== 'post' || true
      : bar.segment === 'regular';

    const key = sessionKind === 'extended'
      ? `${bar.sessionDate}:extended`
      : `${bar.sessionDate}:regular`;

    if (key !== currentKey) {
      currentKey = key;
      sumPv = 0;
      sumV = 0;
    }

    if (!include) return null;

    const tp = (bar.high + bar.low + bar.close) / 3;
    sumPv += tp * bar.volume;
    sumV += bar.volume;
    return sumV > 0 ? sumPv / sumV : null;
  });
}
```

### In Your Codebase
From: `lib/indicators.ts`
```ts
export function vwap(candles: OHLCData[]): (number | null)[] {
  const result: (number | null)[] = [];
  let cumVolume = 0;
  let cumTP = 0;

  for (const candle of candles) {
    const typicalPrice = (high + low + close) / 3;
    cumVolume += safeVolume;
    cumTP += typicalPrice * safeVolume;
    result.push(cumVolume > 0 ? cumTP / cumVolume : null);
  }
}
```

Why it matters: this function is mathematically fine, but it assumes the caller already cut the input to the intended VWAP anchor window.

## Concrete Rules
1. **Session VWAP reset rule**: Reset cumulative VWAP exactly at the chosen anchor boundary, never at UTC midnight and never by naive date string. If strategy says "session VWAP," define whether that means regular session only (usually 09:30-16:00 ET) or full extended session (often 04:00-20:00 ET) and reset once per chosen session. Source: TradingView VWAP docs; NYSE/Nasdaq trading hours.
2. **VWAP accumulation rule**: Only accumulate bars that belong to the chosen session definition. Pre-market bars must not leak into an RTH VWAP, and RTH bars must not be omitted if extended-hours bars are loaded in the same array. Source: TradingView Sessions docs; Nasdaq hours.
3. **Required bar fields**: Every 5-minute bar must have timestamp, open, high, low, close, and volume. Without `high`/`low`, typical-price VWAP is impossible; without `volume`, VWAP is impossible; without precise timestamp/session metadata, resets are ambiguous. Source: Alpaca historical bars endpoint plus TradingView VWAP formula.
4. **Session segmentation rule**: Store or derive, for every bar, the New York trading date and a session segment (`pre`, `regular`, `post`). Do not infer segment later from UTC hour alone. Source: NYSE, Nasdaq, TradingView Sessions.
5. **Extended-hours validity rule**: If a signal is meant to be used only during regular trading, invalidate it when the triggering interaction happens only in pre/post-market. Extended-hours prices are thinner and more volatile; mixing them into RTH rules silently changes the strategy. Source: Nasdaq hours page; Alpaca extended-hours overview.
6. **Fibonacci anchor rule**: Backtest only objectively defined anchors known at the time. Examples: prior day high/low, first 30-minute opening range high/low, last confirmed swing high/low using N bars on each side. Do not use visually selected discretionary swings in historical testing. Source: Fidelity Fibonacci definition plus TradingView anti-lookahead guidance.
7. **No-lookahead rule for swings**: If using swing highs/lows, the swing cannot exist until the confirmation bars have closed. A pivot that needs two bars on the right is unknown until those two later bars exist. Source: TradingView bar state/lookahead docs.
8. **Intrabar-touch rule**: If entry/exit logic depends on a wick touching or crossing VWAP/Fib, close-only bars are insufficient. You need either high/low-aware rules for bar-level approximation or lower-timeframe/tick data to resolve order of events inside the 5-minute bar. Source: TradingView lower-timeframe and bar-state docs.
9. **Ambiguous bar rule**: On a single bar, if both stop and target are inside `[low, high]`, execution order is unknown from 5-minute OHLC alone. The engine must use a deterministic policy (worst case, best case, next-tick/lower-TF reconstruction) and report it. Otherwise results are overstated.
10. **Timezone rule**: Use `America/New_York`, not fixed `UTC-5` or `UTC-4`. DST changes mean fixed offsets are wrong part of the year. Source: TradingView Time docs and exchange use of Eastern Time.
11. **Early-close rule**: Use real exchange calendars. Sessions are not always 09:30-16:00 ET; NYSE/Nasdaq publish early closes such as 1:00 p.m. ET on certain holidays. VWAP and fib anchor windows must end at the actual session close.

## Best Practices
1. Build a canonical `sessionKey` per bar in New York time and reset VWAP from that key, not from array boundaries. Reference: `lib/time-utils.ts:171` and TradingView Time docs.
2. Persist bar metadata for `segment` and `sessionDate` so signal code never re-derives sessions ad hoc. Reference: `lib/massive-market.ts:79`.
3. Separate strategies into `RTH-only` and `extended-hours-aware`; do not let one config silently reuse the other data window. Reference: Nasdaq/NYSE hours and TradingView Sessions docs.
4. When a rule says "touch" or "cross," base historical fills on `high/low`, not `close`, or downsample from lower timeframe data. Reference: TradingView intrabar docs.
5. Encode Fibonacci anchors as pure functions of past bars, then log the selected anchors in test output so you can audit them. Reference: `components/trading/plugins/FibonacciPrimitive.ts:105`.

## Common Pitfalls
**Pitfall**: Resetting VWAP at calendar midnight UTC.
**Solution**: Reset at the intended New York session boundary using `America/New_York` and a real market calendar.

**Pitfall**: Loading 04:00-20:00 data but calling the result "session VWAP" without excluding pre/post-market.
**Solution**: Explicitly choose `regular` or `extended` session mode and filter accumulation accordingly.

**Pitfall**: Backtesting Fibonacci drawn from hindsight-perfect swing points.
**Solution**: Predefine anchors or use swing confirmation that only becomes available after enough right-side bars close.

**Pitfall**: Treating a bar close above VWAP as proof price never traded below VWAP during that bar.
**Solution**: If path matters, use high/low logic or lower timeframe reconstruction.

## Recommended Default Approach
For US-equity 5-minute backtests here, use `America/New_York`, a real exchange calendar, and explicit per-bar `sessionDate` + `segment` metadata. Default session VWAP should be `RTH-only` unless the strategy explicitly claims extended-hours participation. Default Fibonacci anchors should be fully rule-based and confirmable without future bars, such as prior-session extremes or confirmed pivots with fixed lookback/lookforward.

## Action Checklist
- [ ] Add explicit per-bar session metadata: NY trading date, segment, and actual session open/close.
- [ ] Make VWAP calculation accept an anchor/reset function instead of assuming one continuous array.
- [ ] Decide strategy mode: `RTH-only` vs `extended-hours-aware`.
- [ ] Define a formal fill policy for bars where both stop and target are hit intrabar.
- [ ] Define Fibonacci anchor-selection rules in code before trusting any backtest result.

## Known Unknowns
- Vendor bar construction can differ around auctions, corrections, and odd-lot inclusion, so exact OHLCV values may vary across feeds even with the same session rules.
- If you want true touch-order sequencing inside a 5-minute bar, the research says you need lower-timeframe or tick reconstruction; 5-minute OHLCV alone cannot uniquely recover path.
- Some charting platforms treat "regular" and "extended" session names differently by asset class; equities are straightforward, futures less so. For US equities, use exchange hours directly.

## Invariants The Engine Must Enforce
- Every bar has monotonic timestamp ordering and valid `open/high/low/close/volume`.
- `high >= max(open, close, low)` and `low <= min(open, close, high)` for every bar.
- Every bar maps to exactly one New York trading date and exactly one session segment.
- VWAP state resets exactly once per configured session key and never carries across sessions.
- RTH VWAP never includes pre-market or after-hours volume.
- Extended-hours VWAP mode is explicit and test reports label it clearly.
- No signal can use Fibonacci anchors that were not knowable at that timestamp.
- No higher-timeframe or swing-confirmation logic may leak future data.
- If a rule depends on touch/cross, the engine must not evaluate it from closes only unless strategy spec explicitly says "close-confirmed only."
- If both stop and target are reachable within one bar, engine applies one declared ambiguity policy consistently.
- Session boundaries follow exchange calendar including holidays and early closes.
- All session math uses `America/New_York`, never a fixed UTC offset.

## Sources
- NYSE Holidays & Trading Hours: https://www.nyse.com/markets/hours-calendars
- Nasdaq Trading Schedule / Extended Hours: https://www.nasdaq.com/market-activity/stock-market-holiday-schedule
- TradingView VWAP docs: https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/
- TradingView Sessions docs: https://www.tradingview.com/pine-script-docs/concepts/sessions/
- TradingView Time docs: https://www.tradingview.com/pine-script-docs/concepts/time/
- TradingView Bar states docs: https://www.tradingview.com/pine-script-docs/concepts/bar-states/
- TradingView Other timeframes and data docs: https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/
- Alpaca Historical bars API: https://docs.alpaca.markets/reference/stockbars
- Alpaca extended-hours overview: https://alpaca.markets/learn/what-is-extended-hours-trading
- Fidelity Fibonacci Retracement: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/fibonacci-retracement

## Follow-up Questions

---
*To continue learning, use: `/research more about intraday backtest correctness` or ask follow-up questions*
