# Intraday Backtest Execution Simulation With Pyramiding Crash Course
**Researched**: 2026-03-25
**Sources**: Official docs, engine docs, codebase analysis
**Context**: Codebase-specific research for a future intraday backtesting engine using 5-minute bars

---

## Concept Overview
Bar-based execution simulation is about deciding when an order becomes eligible, whether the bar proves it could have filled, and what price/size to assign without pretending you know the true tick path inside the candle. For an intraday engine that pyramids into positions, the hard parts are timing, same-bar ambiguity, average price updates, and keeping sizing/stops consistent after each add.

## How It Works
For strategies that act on completed 5-minute candles, the safest baseline is: evaluate signals at bar close, create orders after that bar is complete, and allow the first fill only on the next bar. Market orders usually fill at the next bar's open. Price-based orders (limit/stop) become active on the next bar and fill only if the next bar's OHLC proves the order was reachable.

On OHLC bars, intrabar sequencing is unknown. Some engines assume a deterministic path inside the bar; others avoid strong claims and recommend lower-timeframe data when same-bar ordering matters. For a v1 retail-style engine, it is better to be explicit, conservative, and simple than to build a fake microstructure model you cannot validate.

## How It Applies Here
This repo already works with 5-minute candle data by default in `hooks/use-candle-data.ts`, computes indicators from OHLCV in `lib/indicators.ts`, and already has trade/execution cost concepts in `lib/types.ts` and `lib/csv-parser.ts`. That means a future backtest engine should likely:

- treat candles as the simulation substrate, not ticks
- represent a trade as a position plus a list of fills/adds/exits
- reuse the existing ideas of `commission`, `fees`, quantity-weighted matching, and execution records
- keep backtest logic separate from charting/market-data fetch code

The repo also hints at separate backtest services in `docs/VALIDATION_MATRIX.md`, but there is no current in-repo execution simulator to preserve, so defaults can be chosen cleanly.

## Codebase Evidence
- `hooks/use-candle-data.ts`: defaults candle requests to `frequencyType = 'minute'` and `frequency = '5'`, which matches the target 5-minute engine.
- `lib/indicators.ts`: indicator math is already OHLCV-based, so signal generation naturally fits completed-bar evaluation.
- `lib/types.ts`: existing `Execution` and `Trade` types already encode price, qty, time, commission, and fees.
- `lib/csv-parser.ts`: existing quantity-weighted commission/fee allocation and partial matching logic is a good mental model for partial exits.
- `docs/VALIDATION_MATRIX.md`: references `services/backtest-gateway` and `services/backtest-worker`, suggesting backtesting is expected to live in dedicated services.

## Practical Findings

### 1) Order timing on completed candles
- Default assumption: signals use only the just-closed bar; fills cannot happen on that same bar.
- Market orders: fill at next bar open.
- Limit/stop/stop-limit orders: become active starting on the next bar.
- Do not let a rule inspect bar `t` close/high/low and also claim a fill inside bar `t`; that is classic look-ahead on OHLC bars.

### 2) Fill models on OHLCV bars
- `Market`: fill at next bar open plus slippage.
- `Limit buy`: if next bar open <= limit, fill at open; else if low <= limit, fill at limit; else no fill. Mirror for sells.
- `Stop buy`: if next bar open >= stop, fill at open; else if high >= stop, fill at stop; else no fill. Mirror for sells.
- `Stop-limit`: first trigger using stop logic, then apply limit logic after trigger; on plain OHLC bars, avoid claiming precise trigger-then-retrace sequencing unless your bar-path rule allows it.
- Gap handling: if price jumps through a stop/limit between bars, fill at next bar open, not the stale order price.
- Volume: simplest v1 is to ignore it for liquid names; optional conservative v1.1 is a per-bar participation cap like `maxFillQty = min(orderQtyRemaining, volume * 0.05)`.

### 3) Modeling adds / pyramiding
- Treat each add as a new fill event with its own timestamp, qty, gross price, slippage, fees, and notes (`entry`, `add1`, `add2`, etc.).
- Update average price with a weighted formula: `newAvg = (oldQty * oldAvg + fillQty * fillPrice) / (oldQty + fillQty)`.
- Track both `positionQty` and `fills[]`; do not collapse everything into one synthetic trade until reporting.
- Enforce explicit rules: max adds, max total size, min bars between adds if desired, and whether adds are only allowed when unrealized PnL is positive.

### 4) Partial exits, stop movement, and sizing after adds
- Partial exits should reduce `positionQty` but should not change the average entry price of remaining shares; realized PnL is booked on the exited quantity only.
- After an add, recompute risk from the new position state, not from the original entry.
- If stops are strategy-defined off average cost, update stop from the new weighted average after the add.
- If stops are structure-based (VWAP, prior low, bar low, etc.), leave the stop price rule unchanged but recalc dollar risk using the new size.
- For same-bar target/stop conflicts after an add, choose a pessimistic rule for v1: if both exit prices were reachable and sequencing is unknowable, assume the adverse fill happened first.

### 5) Realistic but simple v1 costs
- Commission: use a flat broker-style model per share with a floor, or a fixed cents/share number if you know your venue.
- Fees: model SEC/TAF/exchange fees only if they matter for your asset class; otherwise keep a single `feesPerShare` bucket.
- Slippage: start with a one-sided model, e.g. `max(1 tick, price * bps)` in the unfavorable direction. Consider larger bps for opens and for low-priced/high-volatility names.
- Borrow: for long-only, ignore. For shorts, either apply no borrow in v1 and label results as excluding borrow, or apply a simple daily borrow rate only while the short is open. IBKR shows borrow cost can vary materially and can even produce negative rebate situations, so hard-coded short assumptions should be labeled clearly.

### 6) Common biases and how to avoid them
- `Look-ahead bias`: never fill on the signal bar if the strategy acts on completed candles.
- `Same-bar path bias`: do not claim knowledge of whether high or low happened first unless you explicitly define a bar path rule.
- `Optimization bias`: keep execution parameters stable across symbols and periods; do not tune slippage/borrow only until the equity curve looks good.
- `Survivorship bias`: use delisting-aware universes if you later test large equity baskets.
- `Liquidity fantasy`: if you ignore volume and market impact, state that your order size assumes liquid names and small participation.

## Code Examples

### Basic Usage
```ts
type Side = 'buy' | 'sell';

function fillLimit(side: Side, limit: number, nextBar: { open: number; high: number; low: number }) {
  if (side === 'buy') {
    if (nextBar.open <= limit) return nextBar.open;
    if (nextBar.low <= limit) return limit;
    return null;
  }

  if (nextBar.open >= limit) return nextBar.open;
  if (nextBar.high >= limit) return limit;
  return null;
}

function updateAveragePrice(oldQty: number, oldAvg: number, addQty: number, addPrice: number) {
  return ((oldQty * oldAvg) + (addQty * addPrice)) / (oldQty + addQty);
}
```

### In Your Codebase
From: `lib/csv-parser.ts`
```ts
const commission =
  (entry.qty > 0 ? (entry.commission / entry.qty) * q : 0) +
  (exit.qty > 0 ? (exit.commission / exit.qty) * q : 0);
```

That existing quantity-weighted allocation is the same idea a backtester should use for partial exits and multi-fill trades.

## Best Practices
1. Use next-bar activation for all orders generated from completed bars. Source: TradingView strategies docs, Backtrader order execution docs.
2. Prefer explicit, documented fill rules over hidden heuristics. Source: TradingView broker emulator docs, Backtrader order/slippage docs.
3. Store every fill/add/partial exit separately, then derive position/trade summaries. Supported by repo patterns in `lib/types.ts` and `lib/csv-parser.ts`.
4. Use pessimistic handling for ambiguous same-bar stop/target conflicts until lower-timeframe data exists.
5. Keep v1 slippage/fees simple and stable; add complexity only after comparing backtest fills with paper/live fills.

## Common Pitfalls
**Pitfall**: Filling at the signal bar close because the close triggered the signal.
**Solution**: If the close creates the order, earliest fill is next bar.

**Pitfall**: Letting adds retroactively improve earlier fills.
**Solution**: Each add is its own fill event; only the remaining position average updates.

**Pitfall**: Claiming precise same-candle stop/target sequencing on plain OHLC data.
**Solution**: Use a pessimistic ambiguity rule or lower-timeframe data.

## Recommended Default Approach
For v1, use a conservative next-bar OHLC fill model:

- evaluate signals on completed 5-minute bars only
- market orders fill at next bar open plus unfavorable slippage
- limit/stop orders activate on next bar and fill by open-touch rules
- ignore volume for liquid symbols and small size, but cap this with documentation
- represent pyramiding as multiple fills with weighted average price updates
- partial exits reduce quantity and realize PnL without changing remaining average entry
- if both stop and target were reachable in one bar and ordering is unknowable, take the worse outcome

Why: it is simple, explainable, hard to accidentally overstate performance with, and aligned with how major retail-oriented engines handle bar-based simulation before lower-timeframe magnification.

## Action Checklist
- [ ] Define one canonical order-timing rule: completed-bar signal -> next-bar eligibility
- [ ] Implement fill functions for market, limit, stop, and stop-limit
- [ ] Model positions as `fills[] + currentQty + avgEntryPrice + realizedPnl`
- [ ] Add pessimistic same-bar ambiguity handling
- [ ] Add slippage/commission settings and document their defaults
- [ ] Compare backtest fills against paper/live fills before increasing complexity

## Known Unknowns
- There is no single correct intrabar path on OHLC bars. TradingView uses a deterministic bar path; Backtrader uses next-bar bounds plus order-specific rules. Without lower-timeframe data, same-bar sequencing remains an assumption.
- Borrow costs and short availability are highly broker- and symbol-dependent. A simple flat borrow rate is only a placeholder.
- Volume-based partial fills on bar data are rough approximations; true queue position and market impact need deeper data.

## Related Topics
- Lower-timeframe bar magnification for same-bar fills
- Event-driven backtest engines vs vectorized backtests
- Short availability and locate modeling

## Follow-up Questions
- How should same-bar stop/target conflicts be handled for your specific strategy style?
- Do you want a TypeScript position state machine spec for entries, adds, partials, and reversals?

## Sources
- TradingView Pine Script strategies: https://www.tradingview.com/pine-script-docs/concepts/strategies/
- Backtrader order creation/execution: https://www.backtrader.com/docu/order-creation-execution/order-creation-execution/
- Backtrader slippage: https://www.backtrader.com/docu/slippage/slippage/
- Backtrader volume fillers: https://www.backtrader.com/docu/filler/
- HftBacktest order fill: https://hftbacktest.readthedocs.io/en/latest/order_fill.html
- QuantStart on backtest biases: https://www.quantstart.com/articles/Successful-Backtesting-of-Algorithmic-Trading-Strategies-Part-I/
- Interactive Brokers short sale cost: https://www.interactivebrokers.com/en/pricing/short-sale-cost.php

---
*To continue learning, use: `/research more about intraday backtest execution simulation` or ask follow-up questions*
