# Backtesting Engine for 5-Minute VWAP + Fibonacci + Pyramiding
**Researched**: 2026-03-25
**Sources**: Parallel web research, codebase analysis, official docs, open-source engine docs
**Context**: Nexus Terminal-specific research for the simplest trustworthy backtesting engine

---

## Concept Overview
Yes, this can be kept fairly simple.

The simplest version worth building is **not** a tick engine, order book simulator, or separate microservice system. It is a **single-process, bar-by-bar TypeScript backtester** that uses normalized 5-minute candles, precomputed indicators, a small execution simulator, and an immutable fills/equity ledger.

That is enough to backtest objective intraday rules using VWAP and Fibonacci-based levels **if** three things are true:
1. candle timestamps are correct in `America/New_York`
2. VWAP resets are correct for the intended session
3. Fib anchors are rule-based, not discretionary hindsight drawings

If those are not true, the backtest may look polished while being wrong.

## How It Works
Use one canonical candle stream per symbol/timeframe. Precompute indicators over that stream. Then iterate over completed bars only.

For each completed 5-minute bar:
1. expose only data known at that bar close
2. run strategy logic
3. emit intents like `enter`, `add`, `reduce`, `exit`
4. activate orders no earlier than the next bar
5. simulate fills from the next bar's OHLC
6. update lots, average price, realized PnL, unrealized PnL, and equity
7. log everything to a ledger for later charting and review

This is the smallest useful engine because pyramiding, partial exits, and stop movement are stateful. A purely vectorized spreadsheet-style backtest gets brittle fast once you start adding into positions.

## How It Applies Here
Nexus Terminal already has several good building blocks:

- `lib/indicators.ts` already computes SMA, EMA, Bollinger, VWAP, RSI, MACD, ATR
- `lib/time-utils.ts` already uses `America/New_York` and has session helpers
- `components/trading/CandlestickChart.tsx` and `components/trading/ChartsTab.tsx` already render intraday charts and overlays
- `components/trading/plugins/FibonacciPrimitive.ts` already calculates fib prices from two anchors
- `lib/types.ts` and `lib/trading-utils.ts` already model journal trades/PnL at a simple level

So the main missing piece is not charts. It is the **simulation core**.

## Codebase Evidence
- `lib/indicators.ts:101-125` — VWAP is cumulative across the entire candle array and does **not** reset by session.
- `lib/indicators.ts:245-297` — ATR currently returns one extra aligned value pattern and needs verification before reuse in backtests.
- `lib/time-utils.ts:5-15` — project already uses `America/New_York` correctly.
- `lib/time-utils.ts:147-169` — intraday window helper already defines a 04:00-20:00 NY session window.
- `app/api/market-data/route.ts:79-80` — `includePrePost` is accepted but explicitly not forwarded upstream.
- `app/api/market-data/route.ts:135` — malformed upstream bars can currently become `datetime: 0`.
- `lib/chart-timeframes.ts:37-43` — intraday chart requests currently ask for prior session + pre/post session context.
- `hooks/use-candle-data.ts:50-174` — app already fetches and caches 5-minute candles client-side.
- `components/trading/plugins/FibonacciPrimitive.ts:105-119` — Fib levels are just math from two endpoints; anchor selection is external.
- `lib/types.ts:3-42` — existing `Execution`/`Trade` types are journaling-oriented, not simulation-oriented.

## The Simplest Architecture Worth Building

### 1. Canonical candle schema
Every bar needs:
- `symbol`
- `timestamp`
- `open/high/low/close`
- `volume`
- `sessionDate` in New York time
- `segment` = `pre | regular | post`

That extra session metadata matters because session VWAP is impossible to trust if the engine cannot tell which bars belong to which session.

### 2. Precomputed indicators
Keep indicator code simple:
- precompute VWAP
- precompute EMAs/SMAs if needed
- precompute ATR only after fixing alignment

Do not compute indicators ad hoc inside order-fill logic.

### 3. Strategy callback
Use one simple function shape:

```ts
onBar(context) => Intent[]
```

Where intents are high-level actions like:
- buy market next bar
- buy limit at fib 0.618
- add 25% size
- move stop to VWAP
- exit all

### 4. Execution simulator
For v1:
- signals happen on completed bars only
- market orders fill at next bar open plus slippage
- limit/stop orders become active on next bar
- if next bar gaps through the order price, fill at next bar open
- if both stop and target are reachable in one bar, use a declared ambiguity rule

### 5. Position model with lots
Do **not** store only one blended position.

Instead:
- keep open lots/fills
- each add creates a new fill row
- also maintain derived `positionQty`, `avgEntryPrice`, `realizedPnl`

This is the simplest way to support pyramiding without building a fake broker.

## VWAP Rules You Must Enforce
For a 5-minute intraday backtest, session VWAP must be explicit.

Recommended default:
- use **RTH VWAP** only
- reset at 09:30 ET
- stop accumulation at 16:00 ET
- exclude premarket and after-hours unless the strategy explicitly trades them

Why: your code currently fetches wider intraday windows, and `vwap()` currently accumulates across the whole array. That is fine for some chart views, but not good enough for a trustworthy backtest.

If you want extended-hours strategies later, support a second explicit mode:
- `vwapMode: 'regular' | 'extended'`

## Fibonacci Rules You Must Enforce
This is the biggest conceptual trap.

Fib math is easy. Fib **anchors** are the hard part.

If the strategy says “buy the 0.618 retrace,” the engine must know:
- retrace of **what swing?**
- how was that swing chosen?
- was that swing knowable at that timestamp?

So a backtest can only trust Fib if anchor selection is objective. Good v1 examples:
- prior day high to low
- opening range high to low
- confirmed pivot high/low with fixed left/right bar count
- first impulse leg after 09:30 defined by exact rules

Bad example:
- “the swing a human would draw looking at the chart”

That is review/annotation logic, not backtest logic.

## Pyramiding: How Simple Can It Be?
Pretty simple.

Use these rules:
- one position per symbol
- each add is a new fill
- weighted average entry updates after each add
- remaining position keeps its average after partial exits
- stops/targets can be recalculated from average price or kept structure-based
- enforce max adds and max total size

Example v1 policy:
- initial entry = 25% size
- up to 3 adds
- each add only allowed on a later completed bar
- no same-bar add + exit sequencing claims

This keeps the engine explainable.

## What Will Make Results Untrustworthy
- using same-bar information to trigger and fill on the same completed candle
- using session VWAP without session resets
- mixing extended-hours bars into RTH logic silently
- using discretionary Fib anchors
- pretending 5-minute OHLC tells you whether stop or target hit first inside the bar
- ignoring slippage on fast intraday names
- allowing bad timestamps or out-of-order bars into the simulation

## Recommended Default v1 for Nexus Terminal
Build this first:

1. **Single-process TypeScript backtester** inside the main app codebase
2. **5-minute bars only**
3. **One symbol at a time** initially
4. **Completed-bar signals only**
5. **Next-bar execution model**
6. **RTH-only session VWAP by default**
7. **Rule-based Fib anchors only**
8. **Lot-based pyramiding model**
9. **Simple slippage + commission settings**
10. **Chart replay/review UI using existing chart components**

That gives you something you can trust and reason about.

## Recommended Data Model

```ts
type BacktestBar = {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sessionDate: string;
  segment: 'pre' | 'regular' | 'post';
};

type Fill = {
  id: string;
  timestamp: number;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  fee: number;
  tag: 'entry' | 'add' | 'reduce' | 'exit';
};

type PositionState = {
  qty: number;
  avgEntryPrice: number | null;
  realizedPnl: number;
  fills: Fill[];
};
```

## Action Checklist
- [ ] add a canonical intraday bar model with NY session metadata
- [ ] fix or replace session handling for backtest VWAP
- [ ] make VWAP reset by configurable session key
- [ ] define one objective Fib anchor scheme for v1
- [ ] implement a next-bar fill model for market/limit/stop orders
- [ ] represent adds as separate fills/lots
- [ ] store an immutable ledger of bars, intents, fills, and equity
- [ ] add tests for gaps, DST, early closes, same-bar ambiguity, adds, and partial exits
- [ ] validate backtest markers on charts using exact timestamps, not nearest-bar snapping

## Known Unknowns
- whether you want long-only first or long/short from day one
- whether extended-hours participation matters for your setups
- whether 5-minute bars alone are enough, or if ambiguous setups need 1-minute replay later
- whether fib anchors should come from prior session structure, opening range, or pivot logic

## Recommended Default Approach
The answer is:

**Keep it simple, but be strict.**

Simple engine:
- one event loop
- one candle schema
- one execution model
- one lot-based position model

Strict correctness:
- New York session boundaries
- explicit VWAP reset rules
- objective Fib anchor rules
- conservative fill assumptions

That combination is the minimum version that is simple **and** still believable.

## Follow-up Questions
- Which Fib anchor style matches how you actually trade: prior day range, opening range, or confirmed pivots?
- Do you want the first version to be long-only?
- Do you want same-bar stop/target conflicts handled pessimistically by default?

---
*You can ask follow-up questions to extend this research.*
