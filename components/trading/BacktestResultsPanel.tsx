'use client';

import type { BacktestResult } from '@/lib/backtesting/engine';
import { formatCurrency } from '@/lib/trading-utils';
import { format } from 'date-fns';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface BacktestResultsPanelProps {
  result: BacktestResult;
}

export default function BacktestResultsPanel({ result }: BacktestResultsPanelProps) {
  const { stats, equityCurve, trades } = result;

  const equityData = equityCurve
    .filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 200)) === 0 || i === equityCurve.length - 1)
    .map((point) => ({
      date: format(new Date(point.time), 'MM/dd'),
      equity: Number(point.equity.toFixed(2)),
    }));

  const statCards = [
    { label: 'Total Trades', value: stats.totalTrades },
    { label: 'Win Rate', value: `${(stats.winRate * 100).toFixed(1)}%` },
    { label: 'Total P&L', value: formatCurrency(stats.totalPnl), color: stats.totalPnl >= 0 },
    { label: 'Profit Factor', value: stats.profitFactor === Infinity ? 'INF' : stats.profitFactor.toFixed(2) },
    { label: 'Avg Win', value: formatCurrency(stats.avgWin) },
    { label: 'Avg Loss', value: formatCurrency(-stats.avgLoss) },
    { label: 'Max Drawdown', value: `${(stats.maxDrawdownPct * 100).toFixed(1)}%` },
    { label: 'Sharpe Ratio', value: stats.sharpeRatio.toFixed(2) },
    { label: 'Final Equity', value: formatCurrency(stats.finalEquity), color: stats.finalEquity >= stats.initialCapital },
  ];

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-white/5 bg-white/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{card.label}</div>
            <div
              className={`mt-1 text-sm font-semibold ${
                card.color === true ? 'text-emerald-400' : card.color === false ? 'text-rose-400' : 'text-white'
              }`}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Equity Curve</h4>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityData}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value: number | string | undefined) => [formatCurrency(Number(value ?? 0)), 'Equity']}
              />
              <Area type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} fill="url(#equityGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trade log */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Trade Log ({trades.length} trades)</h4>
        <div className="max-h-[200px] overflow-auto rounded-lg border border-white/5">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#121214] text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Direction</th>
                <th className="px-3 py-2 text-left">Entry</th>
                <th className="px-3 py-2 text-left">Exit</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Entry $</th>
                <th className="px-3 py-2 text-right">Exit $</th>
                <th className="px-3 py-2 text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-3 py-1.5">
                    <span className={trade.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>
                      {trade.direction}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-zinc-400">{format(new Date(trade.entryTime), 'MM/dd/yy')}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{format(new Date(trade.exitTime), 'MM/dd/yy')}</td>
                  <td className="px-3 py-1.5 text-right">{trade.qty}</td>
                  <td className="px-3 py-1.5 text-right">${trade.entryPrice.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right">${trade.exitPrice.toFixed(2)}</td>
                  <td className={`px-3 py-1.5 text-right font-medium ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCurrency(trade.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
