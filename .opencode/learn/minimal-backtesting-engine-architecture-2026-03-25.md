# Minimal Backtesting Engine Architecture Crash Course
**Researched**: 2026-03-25
**Sources**: Official docs, project docs, open-source references
**Context**: Personal trading app focused on intraday discretionary strategies on 5-minute candles

---

## Concept Overview
For a personal intraday trading app using 5-minute OHLCV bars, the simplest architecture that still produces trustworthy results is a **bar-by-bar event loop with precomputed indicators**. Pure vectorized backtests are great for screening many parameter combinations, but a small event-driven engine is safer once you care about execution timing, adds, stops, partial exits, and cash/equity bookkeeping.

The trust boundary for a v1 is simple: you are not simulating the exchange or order book, only **decision timing and plausible fills from bar data**. That is enough for discretionary strategy review if you keep assumptions explicit and conservative.

## How It Works
Use normalized 5-minute candles as the only historical input. Precompute indicators over the candle series, then iterate one completed bar at a time. On each bar:

1. Reveal the next completed bar.
2. Read indicator values available at that bar close.
3. Call strategy logic with current state.
4. Emit simple intents (`buy`, `sell`, `add`, `reduce`, `exit`).
5. Convert intents into simulated fills using a small fill model.
6. Update lots/position, cash, realized PnL, unrealized PnL, and equity.
7. Append immutable ledger rows.

That is essentially the smallest useful subset of what larger engines like LEAN, Zipline, backtrader, and backtesting.py do.

## How It Applies Here
For this repo, backtesting is a planned feature, not an implemented one yet. `PRD.md:71` defines a “Strategy Backtester” agent, while `docs/VALIDATION_MATRIX.md:26` and `docs/VALIDATION_MATRIX.md:27` mention `services/backtest-gateway` and `services/backtest-worker`, but those service directories are not present in the workspace. So the practical recommendation is to **start with an in-process TypeScript engine in the app codebase**, not a distributed service split.

Why: a single-process engine is easier to reason about, easier to test, and enough for 5-minute OHLCV discretionary review. Service separation only pays off later if you need large batch jobs, queueing, or isolated Python quant tooling.

## Codebase Evidence
- `PRD.md:19`: product goal explicitly includes “backtest results, refinements”.
- `PRD.md:71`: strategy backtester is planned as an agent capability.
- `docs/VALIDATION_MATRIX.md:26`: references a `services/backtest-gateway` build.
- `docs/VALIDATION_MATRIX.md:27`: references a `services/backtest-worker` Python check.
- Workspace search result: those backtest service directories are currently absent, so there is no active engine implementation to extend.

## Event-Driven vs Vectorized
- **Vectorized**: best for fast research on simple entry/exit rules over arrays; weakest when fills depend on path, state, or multiple adds/reductions. VectorBT explicitly describes its approach as vectorized over pandas/NumPy arrays for speed and large-scale parameter testing: https://vectorbt.dev/
- **Event-driven**: best when order timing and position state matter. Zipline describes itself as an “event-driven system for backtesting”: https://zipline.ml4trading.io/
- **Practical default**: use event-driven execution with vectorized indicator precompute. This keeps the runtime simple while avoiding fragile loop-heavy indicator code.
- **Why not pure vectorized for v1**: pyramiding, partial exits, stop/target logic, and “next bar open vs intrabar touch” rules quickly become path-dependent. Backtesting.py and backtrader both expose object models around orders/trades/positions because this state matters: https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html and https://www.backtrader.com/docu/

## Smallest Viable Components
1. **Data ingestion**
   - Input: normalized candles with timezone, session info, split-adjustment policy, and symbol metadata.
   - Reject missing/duplicate/out-of-order bars.
2. **Bar iterator**
   - Emits one completed 5-minute bar at a time.
   - Never lets strategy inspect future bars.
3. **Indicator engine**
   - Precompute arrays for SMA/EMA/VWAP/ATR/etc.
   - Strategy only reads values up to current bar index.
4. **Strategy callback**
   - Signature like `onBar(ctx) => Intent[]`.
   - Returns intents, not broker-specific orders.
5. **Execution simulator**
   - Fill market orders at next bar open plus slippage.
   - Fill stop/limit only when bar range makes them reachable, using conservative tie-break rules.
6. **Results ledger**
   - Immutable arrays/tables for fills, lots, realized PnL, and equity curve.

## Recommended Data Model

### Candle
```ts
type Candle = {
  symbol: string;
  ts: string; // ISO start or end time, but be consistent
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  session: 'rth' | 'eth';
};
```

### Intent / Order
```ts
type OrderIntent = {
  id: string;
  ts: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  kind: 'market' | 'limit' | 'stop';
  price?: number;
  reason?: string;
  tags?: string[];
};
```

### Fill
```ts
type Fill = {
  id: string;
  orderId: string;
  ts: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  fee: number;
  slippage: number;
};
```

### Position / Lots
```ts
type PositionLot = {
  lotId: string;
  symbol: string;
  side: 'long' | 'short';
  entryTs: string;
  qtyOpen: number;
  entryPrice: number;
  stopPrice?: number;
  targetPrice?: number;
  tag?: string;
};
```

### Equity Curve Row
```ts
type EquityPoint = {
  ts: string;
  cash: number;
  grossExposure: number;
  netPositionQty: number;
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
  drawdown: number;
};
```

## Pyramiding Without Full Broker Emulation
- Represent a position as **open lots**, not one averaged blob. Each add creates a new lot with its own entry time, qty, and optional stop/target.
- Also maintain a derived aggregate view for UI: net qty, average cost, worst stop, total risk.
- Use a simple close policy: FIFO by default, with optional “close tagged lot” support later.
- Cap complexity with clear rules:
  - only one symbol at a time in v1 if that matches the discretionary workflow,
  - only market/stop/limit orders,
  - no margin model beyond hard max position size,
  - no queue position or level-2 simulation.
- TradingView’s docs show why bar-based engines need explicit intrabar assumptions; if a bar can hit both stop and target, you need a deterministic rule or lower timeframe data: https://www.tradingview.com/pine-script-docs/concepts/strategies/

## Acceptable v1 Assumptions
- Signals are generated on **bar close**.
- Market entries/exits fill at **next bar open** plus configurable slippage.
- Limit/stop fills only occur if next bar range touches the level.
- Commission is fixed per share/order or bps-based and always applied.
- No borrowing cost, locate cost, queue position, or market impact.
- No fills outside regular trading hours unless explicitly enabled.
- Equity is marked on bar close only.

These assumptions are acceptable for discretionary 5-minute review because they are understandable, testable, and conservative enough if documented.

## Assumptions That Invalidate Results
- Using same-bar high/low to decide entries before the bar closes (look-ahead).
- Filling market orders on the signal bar close without proving that is how the strategy is traded.
- Allowing both stop and target to fill on the same bar without a fixed priority rule or lower-timeframe replay.
- Ignoring fees/slippage for thin or fast intraday names.
- Mixing split-adjusted indicators with unadjusted execution prices.
- Using survivorship-biased symbol universes for stock scans. QuantStart explicitly calls survivorship and look-ahead bias out as major backtest hazards: https://www.quantstart.com/articles/Research-Backtesting-Environments-in-Python-with-pandas/

## Open-Source References Worth Copying Selectively
- **backtesting.py**: very small API, useful order/trade/position object vocabulary; good reference for a minimal engine surface: https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html and https://github.com/kernc/backtesting.py
- **backtrader**: broad feature set, especially order types, slippage, fillers, and analyzers; copy concepts, not complexity: https://www.backtrader.com/docu/ and https://github.com/mementum/backtrader
- **Zipline**: event-driven mental model and calendar-aware research pipeline: https://zipline.ml4trading.io/
- **LEAN / QuantConnect docs**: strong source for fill/slippage “reality modeling” concepts even if LEAN is too large for this use case: https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/algorithm-engine

## Recommended Default Approach
Build a **single-process TypeScript, event-driven bar backtester with precomputed indicators and a conservative next-bar execution model**.

That is the simplest architecture that still produces trustworthy results for intraday discretionary 5-minute strategies because it preserves time ordering, handles adds/partials cleanly, and avoids pretending OHLCV bars contain more execution truth than they do.

## Action Checklist
- [ ] Normalize a single canonical candle schema with timezone/session guarantees.
- [ ] Implement immutable ledgers for intents, fills, lots, and equity.
- [ ] Enforce next-bar execution as the default.
- [ ] Add explicit intrabar tie-break rules for stop/target conflicts.
- [ ] Start with one symbol and one timeframe before multi-asset support.
- [ ] Test look-ahead, gaps, adds, partial exits, and stop/target edge cases.

## Known Unknowns
- Whether you need short-selling, premarket, and multi-symbol portfolio interactions in v1.
- Whether fills should use only 5-minute bars or optionally replay 1-minute bars for stop/target accuracy.
- Whether tax lots must match broker statements exactly, or only strategy analytics need to be directionally correct.

## Related Topics
- Walk-forward testing and parameter stability
- Slippage/commission calibration from broker exports
- Lower-timeframe replay for intrabar stop/target resolution

## Follow-up Questions
- None yet.

---
*To continue learning, use: `/research more about backtesting execution models` or ask follow-up questions*
