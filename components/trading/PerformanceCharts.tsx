'use client';

import React, { useCallback, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { Trade } from '@/lib/types';
import { formatCurrency, formatR } from '@/lib/trading-utils';
import { format } from 'date-fns';

interface PerformanceChartsProps {
  trades: Trade[];
  metric: '$' | 'R';
  pnlMode?: 'net' | 'gross';
}

type PointValue = { value: number };

type DailyPoint = {
  date: string;
  value: number;
  cumulative: number;
  drawdown: number;
};

export default function PerformanceCharts({ trades, metric, pnlMode = 'net' }: PerformanceChartsProps) {
  const tradePnl = useCallback((trade: Trade) => (pnlMode === 'gross' ? trade.grossPnl : trade.netPnl), [pnlMode]);
  const metricValue = useCallback(
    (trade: Trade) => {
      if (metric === 'R') {
        return trade.initialRisk ? tradePnl(trade) / trade.initialRisk : 0;
      }
      return tradePnl(trade);
    },
    [metric, tradePnl],
  );

  const chartData = useMemo(() => {
    const dailyTotals = new Map<string, { date: Date; value: number }>();

    trades.forEach((trade) => {
      const key = trade.sortKey;
      const current = dailyTotals.get(key);
      const value = metricValue(trade);
      if (!current) {
        dailyTotals.set(key, {
          date: new Date(trade.date),
          value,
        });
        return;
      }
      current.value += value;
    });

    return Array.from(dailyTotals.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce<{ points: DailyPoint[]; peak: number }>(
        (acc, [, day]) => {
          const previousCumulative = acc.points.at(-1)?.cumulative ?? 0;
          const cumulative = previousCumulative + day.value;
          const peak = Math.max(acc.peak, cumulative);

          return {
            peak,
            points: [
              ...acc.points,
              {
                date: format(day.date, 'MM/dd'),
                value: day.value,
                cumulative,
                drawdown: cumulative - peak,
              },
            ],
          };
        },
        { points: [], peak: 0 },
      )
      .points;
  }, [trades, metricValue]);

  const formatValue = (value: number) => (metric === '$' ? formatCurrency(value) : formatR(value));

  const dayOfWeekData = useMemo(() => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const stats = days.map((day) => ({ name: day, value: 0 }));

    trades.forEach((trade) => {
      const dayIdx = new Date(trade.date).getDay();
      stats[dayIdx].value += metricValue(trade);
    });

    return stats.filter((day) => (day.name !== 'Sunday' && day.name !== 'Saturday') || day.value !== 0);
  }, [trades, metricValue]);

  const timeOfDayData = useMemo(() => {
    const stats = Array.from({ length: 24 }, (_, i) => ({
      name: `${i}:00`,
      hour: i,
      value: 0,
    }));

    trades.forEach((trade) => {
      const hour = new Date(trade.date).getHours();
      stats[hour].value += metricValue(trade);
    });

    return stats.filter((slot) => trades.some((trade) => new Date(trade.date).getHours() === slot.hour));
  }, [trades, metricValue]);

  const winLossDayData = useMemo(() => {
    const winDays = chartData.filter((day) => day.value > 0).length;
    const lossDays = chartData.filter((day) => day.value < 0).length;

    return [
      { name: 'Win Days', value: winDays },
      { name: 'Loss Days', value: lossDays },
    ];
  }, [chartData]);

  const tagBreakdownData = useMemo(() => {
    const tagMap = new Map<string, { count: number; value: number }>();

    trades.forEach((trade) => {
      const uniqueTags = Array.from(new Set((trade.tags ?? []).map((tag) => tag.trim()).filter(Boolean)));

      uniqueTags.forEach((tag) => {
        const current = tagMap.get(tag) ?? { count: 0, value: 0 };
        current.count += 1;
        current.value += metricValue(trade);
        tagMap.set(tag, current);
      });
    });

    return Array.from(tagMap.entries())
      .map(([tag, stats]) => ({ tag, ...stats }))
      .sort((a, b) => b.count - a.count || Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 10);
  }, [trades, metricValue]);

  if (trades.length === 0) {
    return (
      <div className="bg-[#121214] border border-white/5 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
        <BarChart3 className="w-12 h-12 text-zinc-700 mb-4" />
        <p className="text-zinc-500 text-sm">Import trades to see performance analytics</p>
      </div>
    );
  }

  const metricLabel = metric === '$' ? `${pnlMode === 'net' ? 'Net' : 'Gross'} $` : 'R';

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">Equity Curve ({metricLabel})</h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorPnL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(Number(v))} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                itemStyle={{ color: '#10b981' }}
                formatter={(value?: number) => [formatValue(Number(value || 0)), 'Equity']}
              />
              <Area type="monotone" dataKey="cumulative" stroke="#10b981" fillOpacity={1} fill="url(#colorPnL)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">Daily Performance ({metricLabel})</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(Number(v))} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value?: number) => [formatValue(Number(value || 0)), 'Performance']}
              />
              <Bar dataKey="value">
                {chartData.map((entry: PointValue, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">Performance by Day of Week ({metricLabel})</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={dayOfWeekData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(Number(v))} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value?: number) => [formatValue(Number(value || 0)), 'PnL']}
              />
              <Bar dataKey="value">
                {dayOfWeekData.map((entry: PointValue, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">Performance by Time of Day ({metricLabel})</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={timeOfDayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(Number(v))} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value?: number) => [formatValue(Number(value || 0)), 'PnL']}
              />
              <Bar dataKey="value">
                {timeOfDayData.map((entry: PointValue, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[320px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">Win vs Loss Days</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={winLossDayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value?: number) => [`${Number(value || 0)} days`, 'Count']}
              />
              <Bar dataKey="value">
                {winLossDayData.map((entry, index) => (
                  <Cell key={`win-loss-${index}`} fill={entry.name === 'Win Days' ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[320px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">Drawdown</h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorDrawdown" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(Number(v))} />
              <ReferenceLine y={0} stroke="#ffffff22" />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value?: number) => [formatValue(Number(value || 0)), 'Drawdown']}
              />
              <Area type="monotone" dataKey="drawdown" stroke="#f43f5e" fillOpacity={1} fill="url(#colorDrawdown)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[320px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">Tag Breakdown</h3>
          {tagBreakdownData.length === 0 ? (
            <div className="h-[85%] flex items-center justify-center text-xs text-zinc-500">No tagged trades yet</div>
          ) : (
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={tagBreakdownData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" horizontal={false} />
                <XAxis type="number" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis dataKey="tag" type="category" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} width={85} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  formatter={(value?: number) => [`${Number(value || 0)} trades`, 'Tagged Trades']}
                />
                <Bar dataKey="count" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
