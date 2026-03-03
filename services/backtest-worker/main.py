"""
Backtest Worker — Consumes jobs from Redis/BullMQ and runs vectorized backtests.
Uses pandas/numpy for fast computation.
"""

import json
import os
import time
import traceback

import numpy as np
import pandas as pd
import redis

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME = "backtest"
POLL_INTERVAL = 1  # seconds


def connect_redis():
    return redis.Redis.from_url(REDIS_URL, decode_responses=True)


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()


def run_sma_crossover(df: pd.DataFrame, params: dict, initial_capital: float, position_size_pct: float) -> dict:
    fast_period = int(params.get("fastPeriod", 10))
    slow_period = int(params.get("slowPeriod", 30))

    df = df.copy()
    df["fast_sma"] = sma(df["close"], fast_period)
    df["slow_sma"] = sma(df["close"], slow_period)
    df.dropna(inplace=True)

    if len(df) == 0:
        return {"trades": [], "equityCurve": [], "stats": empty_stats(initial_capital)}

    equity = initial_capital
    position = None
    trades = []
    equity_curve = []

    for i in range(1, len(df)):
        row = df.iloc[i]
        prev = df.iloc[i - 1]

        # Exit check
        if position is not None:
            should_exit = False
            if position["direction"] == "LONG" and row["fast_sma"] < row["slow_sma"]:
                should_exit = True
            elif position["direction"] == "SHORT" and row["fast_sma"] > row["slow_sma"]:
                should_exit = True

            if should_exit:
                exit_price = row["close"]
                if position["direction"] == "LONG":
                    pnl = (exit_price - position["entryPrice"]) * position["qty"]
                else:
                    pnl = (position["entryPrice"] - exit_price) * position["qty"]
                equity += pnl
                trades.append({
                    "direction": position["direction"],
                    "entryTime": position["entryTime"],
                    "exitTime": int(row["time"]),
                    "entryPrice": position["entryPrice"],
                    "exitPrice": exit_price,
                    "qty": position["qty"],
                    "pnl": pnl,
                })
                position = None

        # Entry check
        if position is None:
            signal = None
            if prev["fast_sma"] <= prev["slow_sma"] and row["fast_sma"] > row["slow_sma"]:
                signal = "LONG"
            elif prev["fast_sma"] >= prev["slow_sma"] and row["fast_sma"] < row["slow_sma"]:
                signal = "SHORT"

            if signal:
                entry_price = row["close"]
                qty = int((equity * position_size_pct) / entry_price)
                if qty > 0:
                    position = {
                        "direction": signal,
                        "entryPrice": entry_price,
                        "entryTime": int(row["time"]),
                        "qty": qty,
                    }

        # Mark to market
        mtm = equity
        if position:
            if position["direction"] == "LONG":
                mtm += (row["close"] - position["entryPrice"]) * position["qty"]
            else:
                mtm += (position["entryPrice"] - row["close"]) * position["qty"]
        equity_curve.append({"time": int(row["time"]), "equity": mtm})

    stats = compute_stats(trades, equity_curve, initial_capital, equity)
    return {"trades": trades, "equityCurve": equity_curve, "stats": stats}


def compute_stats(trades, equity_curve, initial_capital, final_equity):
    if not trades:
        return empty_stats(initial_capital)

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    total_wins = sum(t["pnl"] for t in wins)
    total_losses = abs(sum(t["pnl"] for t in losses))

    # Max drawdown
    peak = 0
    max_dd = 0
    max_dd_pct = 0
    for pt in equity_curve:
        if pt["equity"] > peak:
            peak = pt["equity"]
        dd = peak - pt["equity"]
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = dd / peak if peak > 0 else 0

    # Sharpe
    sharpe = 0
    if len(equity_curve) > 1:
        returns = []
        for i in range(1, len(equity_curve)):
            prev_eq = equity_curve[i - 1]["equity"]
            if prev_eq > 0:
                returns.append((equity_curve[i]["equity"] - prev_eq) / prev_eq)
        if returns:
            arr = np.array(returns)
            mean_r = arr.mean()
            std_r = arr.std()
            if std_r > 0:
                sharpe = (mean_r / std_r) * np.sqrt(252)

    return {
        "totalTrades": len(trades),
        "winningTrades": len(wins),
        "losingTrades": len(losses),
        "winRate": len(wins) / len(trades) if trades else 0,
        "totalPnl": final_equity - initial_capital,
        "avgWin": total_wins / len(wins) if wins else 0,
        "avgLoss": total_losses / len(losses) if losses else 0,
        "profitFactor": total_wins / total_losses if total_losses > 0 else float("inf") if total_wins > 0 else 0,
        "maxDrawdown": max_dd,
        "maxDrawdownPct": max_dd_pct,
        "sharpeRatio": sharpe,
        "initialCapital": initial_capital,
        "finalEquity": final_equity,
    }


def empty_stats(initial_capital):
    return {
        "totalTrades": 0, "winningTrades": 0, "losingTrades": 0,
        "winRate": 0, "totalPnl": 0, "avgWin": 0, "avgLoss": 0,
        "profitFactor": 0, "maxDrawdown": 0, "maxDrawdownPct": 0,
        "sharpeRatio": 0, "initialCapital": initial_capital, "finalEquity": initial_capital,
    }


STRATEGY_HANDLERS = {
    "sma-crossover": run_sma_crossover,
}


def process_job(job_data: dict) -> dict:
    strategy = job_data.get("strategy", "sma-crossover")
    candles = job_data.get("candles", [])
    params = job_data.get("params", {})
    initial_capital = job_data.get("initialCapital", 10000)
    position_size_pct = job_data.get("positionSizePct", 0.1)

    df = pd.DataFrame(candles)
    if df.empty:
        return {"trades": [], "equityCurve": [], "stats": empty_stats(initial_capital)}

    handler = STRATEGY_HANDLERS.get(strategy)
    if not handler:
        raise ValueError(f"Unknown strategy: {strategy}")

    return handler(df, params, initial_capital, position_size_pct)


def main():
    """Poll Redis for BullMQ jobs and process them."""
    r = connect_redis()
    print(f"Backtest worker started, polling queue: {QUEUE_NAME}")

    while True:
        try:
            # BullMQ stores jobs in bull:{queue}:wait list
            result = r.brpoplpush(f"bull:{QUEUE_NAME}:wait", f"bull:{QUEUE_NAME}:active", timeout=5)
            if result is None:
                continue

            job_id = result
            job_key = f"bull:{QUEUE_NAME}:{job_id}"
            job_raw = r.hget(job_key, "data")

            if not job_raw:
                continue

            job_data = json.loads(job_raw)
            print(f"Processing job {job_id}: strategy={job_data.get('strategy')}")

            try:
                result_data = process_job(job_data)
                # Store result
                r.hset(job_key, "returnvalue", json.dumps(result_data))
                r.hset(job_key, "processedOn", str(int(time.time() * 1000)))
                r.hset(job_key, "finishedOn", str(int(time.time() * 1000)))
                # Move to completed
                r.lrem(f"bull:{QUEUE_NAME}:active", 1, job_id)
                r.zadd(f"bull:{QUEUE_NAME}:completed", {job_id: time.time() * 1000})
                print(f"Job {job_id} completed: {len(result_data.get('trades', []))} trades")
            except Exception as e:
                traceback.print_exc()
                r.hset(job_key, "failedReason", str(e))
                r.lrem(f"bull:{QUEUE_NAME}:active", 1, job_id)
                r.zadd(f"bull:{QUEUE_NAME}:failed", {job_id: time.time() * 1000})
                print(f"Job {job_id} failed: {e}")

        except Exception as e:
            print(f"Worker error: {e}")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
