import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '@/lib/backtesting/engine';
import { ALL_STRATEGIES } from '@/lib/backtesting/strategies';
import type { OHLCData } from '@/lib/indicators';

type WorkerStats = {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  finalEquity: number;
};

type WorkerResult = {
  stats: WorkerStats;
};

function makeCandles(length: number): OHLCData[] {
  const candles: OHLCData[] = [];
  for (let i = 0; i < length; i += 1) {
    const base = 100 + (i * 0.2) + Math.sin(i / 4) * 9;
    candles.push({
      time: i + 1,
      open: base - 0.3,
      high: base + 1.2,
      low: base - 1.2,
      close: base,
      volume: 1000 + i,
    });
  }
  return candles;
}

function runPythonWorker(payload: Record<string, unknown>): WorkerResult {
  const pythonBin = resolve(process.cwd(), '.venv-backtest/bin/python');
  const tempDir = mkdtempSync(resolve(tmpdir(), 'nexus-parity-'));
  const payloadPath = resolve(tempDir, 'payload.json');
  writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');
  const script = `
import importlib.util
import json
import pathlib
import math
import sys

root = pathlib.Path.cwd()
worker_path = root / 'services' / 'backtest-worker' / 'main.py'
payload_path = pathlib.Path(sys.argv[1])
payload = json.loads(payload_path.read_text())
spec = importlib.util.spec_from_file_location('worker_main', worker_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

result = module.process_job(payload)
stats = result.get('stats', {})
for key, value in list(stats.items()):
    if isinstance(value, float) and not math.isfinite(value):
        stats[key] = None
print(json.dumps({'stats': stats}))
`;

  try {
    const result = spawnSync(pythonBin, ['-c', script, payloadPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.status !== 0) {
      throw new Error(`Python worker execution failed: ${result.stderr || result.stdout}`);
    }

    return JSON.parse(result.stdout) as WorkerResult;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function expectNear(actual: number, expected: number, epsilon = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
}

describe('backtest strategy parity (TS engine vs Python worker)', () => {
  const pythonBin = resolve(process.cwd(), '.venv-backtest/bin/python');
  const parityIt = existsSync(pythonBin) ? it : it.skip;

  parityIt('matches for sma-crossover, mean-reversion, and breakout within tolerance', () => {
    const candles = makeCandles(180);

    for (const strategyId of ['sma-crossover', 'mean-reversion', 'breakout'] as const) {
      const strategy = ALL_STRATEGIES.find((item) => item.id === strategyId);
      if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

      const params = Object.fromEntries(strategy.params.map((param) => [param.key, param.defaultValue]));
      const tsConfig = strategy.createConfig(params);
      const tsResult = runBacktest(candles, {
        initialCapital: 10000,
        positionSizePct: 0.1,
        ...tsConfig,
      });

      const workerResult = runPythonWorker({
        strategy: strategyId,
        params,
        initialCapital: 10000,
        positionSizePct: 0.1,
        candles,
      });

      // Tolerance rationale:
      // - SMA warmup handling differs slightly between TS and Python implementations.
      // - We enforce close agreement on outcome metrics while allowing minor execution variance.
      expect(Math.abs(workerResult.stats.totalTrades - tsResult.stats.totalTrades)).toBeLessThanOrEqual(1);
      expectNear(workerResult.stats.winRate, tsResult.stats.winRate, 0.15);
      expectNear(workerResult.stats.totalPnl, tsResult.stats.totalPnl, 300);
      expectNear(workerResult.stats.maxDrawdown, tsResult.stats.maxDrawdown, 500);
      expectNear(workerResult.stats.finalEquity, tsResult.stats.finalEquity, 300);
    }
  });
});
