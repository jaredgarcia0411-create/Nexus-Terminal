import importlib.util
import json
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def worker_module():
    module_path = Path(__file__).resolve().parents[1] / "main.py"
    spec = importlib.util.spec_from_file_location("backtest_worker_main", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def crossover_candles():
    closes = [10, 9, 8, 9, 10, 9, 8, 7]
    return [{"time": i + 1, "close": close} for i, close in enumerate(closes)]


def test_connect_redis_uses_url_and_decode_responses(worker_module, monkeypatch):
    monkeypatch.setattr(worker_module, "REDIS_URL", "redis://example:6380/0")
    from_url = MagicMock(return_value="redis-client")
    monkeypatch.setattr(worker_module.redis.Redis, "from_url", from_url)

    client = worker_module.connect_redis()

    assert client == "redis-client"
    from_url.assert_called_once_with("redis://example:6380/0", decode_responses=True)


def test_sma_rolling_mean_is_deterministic(worker_module):
    result = worker_module.sma(pd.Series([1.0, 2.0, 3.0, 4.0]), 3)

    assert np.isnan(result.iloc[0])
    assert np.isnan(result.iloc[1])
    assert result.iloc[2] == pytest.approx(2.0)
    assert result.iloc[3] == pytest.approx(3.0)


def test_empty_stats_defaults(worker_module):
    initial_capital = 5_000.0

    assert worker_module.empty_stats(initial_capital) == {
        "totalTrades": 0,
        "winningTrades": 0,
        "losingTrades": 0,
        "winRate": 0,
        "totalPnl": 0,
        "avgWin": 0,
        "avgLoss": 0,
        "profitFactor": 0,
        "maxDrawdown": 0,
        "maxDrawdownPct": 0,
        "sharpeRatio": 0,
        "initialCapital": initial_capital,
        "finalEquity": initial_capital,
    }


def test_compute_stats_returns_empty_stats_when_no_trades(worker_module):
    stats = worker_module.compute_stats([], [{"time": 1, "equity": 1_000}], 1_000, 1_200)

    assert stats == worker_module.empty_stats(1_000)


def test_compute_stats_calculates_core_metrics(worker_module):
    trades = [
        {"pnl": 100.0},
        {"pnl": -40.0},
        {"pnl": -10.0},
    ]
    equity_curve = [
        {"time": 1, "equity": 1000.0},
        {"time": 2, "equity": 1100.0},
        {"time": 3, "equity": 1060.0},
        {"time": 4, "equity": 1050.0},
        {"time": 5, "equity": 1200.0},
    ]

    stats = worker_module.compute_stats(trades, equity_curve, 1_000.0, 1_200.0)

    assert stats["totalTrades"] == 3
    assert stats["winningTrades"] == 1
    assert stats["losingTrades"] == 2
    assert stats["winRate"] == pytest.approx(1 / 3)
    assert stats["totalPnl"] == pytest.approx(200.0)
    assert stats["avgWin"] == pytest.approx(100.0)
    assert stats["avgLoss"] == pytest.approx(25.0)
    assert stats["profitFactor"] == pytest.approx(2.0)
    assert stats["maxDrawdown"] == pytest.approx(50.0)
    assert stats["maxDrawdownPct"] == pytest.approx(50 / 1100)
    assert stats["sharpeRatio"] > 0
    assert stats["initialCapital"] == pytest.approx(1000.0)
    assert stats["finalEquity"] == pytest.approx(1200.0)


def test_run_sma_crossover_empty_after_dropna(worker_module):
    candles = [{"time": 1, "close": 100.0}, {"time": 2, "close": 101.0}]
    df = pd.DataFrame(candles)

    result = worker_module.run_sma_crossover(
        df,
        params={"fastPeriod": 2, "slowPeriod": 3},
        initial_capital=1_000.0,
        position_size_pct=0.5,
    )

    assert result["trades"] == []
    assert result["equityCurve"] == []
    assert result["stats"] == worker_module.empty_stats(1_000.0)


def test_run_sma_crossover_generates_expected_trade(worker_module, crossover_candles):
    result = worker_module.run_sma_crossover(
        pd.DataFrame(crossover_candles),
        params={"fastPeriod": 2, "slowPeriod": 3},
        initial_capital=1_000.0,
        position_size_pct=0.5,
    )

    assert len(result["trades"]) == 1
    trade = result["trades"][0]
    assert trade["direction"] == "LONG"
    assert trade["entryTime"] == 5
    assert trade["exitTime"] == 7
    assert float(trade["entryPrice"]) == pytest.approx(10.0)
    assert float(trade["exitPrice"]) == pytest.approx(8.0)
    assert trade["qty"] == 50
    assert float(trade["pnl"]) == pytest.approx(-100.0)
    assert result["stats"]["finalEquity"] == pytest.approx(900.0)


def test_process_job_returns_empty_for_empty_candles(worker_module):
    result = worker_module.process_job({"candles": [], "initialCapital": 777})

    assert result["trades"] == []
    assert result["equityCurve"] == []
    assert result["stats"] == worker_module.empty_stats(777)


def test_process_job_raises_for_unknown_strategy(worker_module):
    with pytest.raises(ValueError, match="Unknown strategy"):
        worker_module.process_job(
            {
                "strategy": "not-real",
                "candles": [{"time": 1, "close": 100.0}],
                "params": {},
            }
        )


def test_process_job_dispatches_to_strategy_handler(worker_module, monkeypatch):
    fake_handler = MagicMock(return_value={"trades": [{"id": 1}], "equityCurve": [{"time": 1}], "stats": {"x": 1}})
    monkeypatch.setitem(worker_module.STRATEGY_HANDLERS, "custom", fake_handler)
    candles = [{"time": 1, "close": 100.0}, {"time": 2, "close": 101.0}]

    result = worker_module.process_job(
        {
            "strategy": "custom",
            "candles": candles,
            "params": {"a": 1},
            "initialCapital": 5_000,
            "positionSizePct": 0.2,
        }
    )

    assert result == {"trades": [{"id": 1}], "equityCurve": [{"time": 1}], "stats": {"x": 1}}
    assert fake_handler.call_count == 1
    call_args = fake_handler.call_args.args
    assert isinstance(call_args[0], pd.DataFrame)
    assert call_args[0].to_dict(orient="records") == candles
    assert call_args[1] == {"a": 1}
    assert call_args[2] == 5_000
    assert call_args[3] == 0.2


def test_main_marks_job_completed(worker_module, monkeypatch):
    fake_redis = MagicMock()
    fake_redis.brpoplpush.side_effect = ["job-1", KeyboardInterrupt()]
    fake_redis.hget.return_value = json.dumps(
        {"strategy": "sma-crossover", "candles": [{"time": 1, "close": 100.0}]}
    )
    job_result = {"trades": [{"id": 1}], "equityCurve": [{"time": 1, "equity": 100.0}], "stats": {"k": 1}}

    monkeypatch.setattr(worker_module, "connect_redis", lambda: fake_redis)
    monkeypatch.setattr(worker_module, "process_job", lambda _: job_result)
    monkeypatch.setattr(worker_module.time, "time", lambda: 1000.0)

    with pytest.raises(KeyboardInterrupt):
        worker_module.main()

    hset_calls = [call.args for call in fake_redis.hset.call_args_list]
    assert fake_redis.hset.call_count == 3
    assert ("bull:backtest:job-1", "returnvalue", json.dumps(job_result)) in hset_calls
    assert ("bull:backtest:job-1", "processedOn", "1000000") in hset_calls
    assert ("bull:backtest:job-1", "finishedOn", "1000000") in hset_calls
    fake_redis.lrem.assert_called_with("bull:backtest:active", 1, "job-1")
    fake_redis.zadd.assert_called_with("bull:backtest:completed", {"job-1": 1000000.0})


def test_main_marks_job_failed_on_processing_exception(worker_module, monkeypatch):
    fake_redis = MagicMock()
    fake_redis.brpoplpush.side_effect = ["job-2", KeyboardInterrupt()]
    fake_redis.hget.return_value = json.dumps(
        {"strategy": "sma-crossover", "candles": [{"time": 1, "close": 100.0}]}
    )

    def boom(_):
        raise RuntimeError("boom")

    monkeypatch.setattr(worker_module, "connect_redis", lambda: fake_redis)
    monkeypatch.setattr(worker_module, "process_job", boom)
    monkeypatch.setattr(worker_module.time, "time", lambda: 2000.0)
    monkeypatch.setattr(worker_module.traceback, "print_exc", MagicMock())

    with pytest.raises(KeyboardInterrupt):
        worker_module.main()

    assert ("bull:backtest:job-2", "failedReason", "boom") in [call.args for call in fake_redis.hset.call_args_list]
    fake_redis.lrem.assert_called_with("bull:backtest:active", 1, "job-2")
    fake_redis.zadd.assert_called_with("bull:backtest:failed", {"job-2": 2000000.0})


def test_main_skips_job_without_data(worker_module, monkeypatch):
    fake_redis = MagicMock()
    fake_redis.brpoplpush.side_effect = ["job-3", KeyboardInterrupt()]
    fake_redis.hget.return_value = None
    process_job = MagicMock()

    monkeypatch.setattr(worker_module, "connect_redis", lambda: fake_redis)
    monkeypatch.setattr(worker_module, "process_job", process_job)

    with pytest.raises(KeyboardInterrupt):
        worker_module.main()

    process_job.assert_not_called()
    fake_redis.hset.assert_not_called()
    fake_redis.zadd.assert_not_called()
