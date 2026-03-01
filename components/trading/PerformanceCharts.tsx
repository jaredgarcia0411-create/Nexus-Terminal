'use client';

import React, { useMemo } from 'react';
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
  Cell
} from 'recharts';
import { Trade } from '@/lib/types';
import { formatCurrency, formatR } from '@/lib/trading-utils';
import { format } from 'date-fns';

interface PerformanceChartsProps {
  trades: Trade[];
  metric: '$' | 'R';
}

export default function PerformanceCharts({ trades, metric }: PerformanceChartsProps) {
  const chartData = useMemo(() => {
    const dailyTotals = new Map<string, { date: Date; value: number }>();

    trades.forEach((trade) => {
      const key = trade.sortKey;
      const current = dailyTotals.get(key);
      const value = metric === '$' ? trade.pnl : (trade.initialRisk ? trade.pnl / trade.initialRisk : 0);
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
      .reduce<Array<{ date: string; value: number; cumulative: number }>>((acc, [, day]) => {
        const previousCumulative = acc.at(-1)?.cumulative ?? 0;
        acc.push({
          date: format(day.date, 'MM/dd'),
          value: day.value,
          cumulative: previousCumulative + day.value,
        });
        return acc;
      }, []);
  }, [trades, metric]);

  const formatValue = (v: number) => metric === '$' ? formatCurrency(v) : formatR(v);

  // Performance by Day of Week
  const dayOfWeekData = useMemo(() => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const stats = days.map(day => ({ name: day, value: 0 }));
    
    trades.forEach(trade => {
      const dayIdx = new Date(trade.date).getDay();
      const val = metric === '$' ? trade.pnl : (trade.initialRisk ? trade.pnl / trade.initialRisk : 0);
      stats[dayIdx].value += val;
    });
    
    return stats.filter(d => d.name !== 'Sunday' && d.name !== 'Saturday' || d.value !== 0);
  }, [trades, metric]);

  // Performance by Time of Day (Hour)
  const timeOfDayData = useMemo(() => {
    const stats = Array.from({ length: 24 }, (_, i) => ({ 
      name: `${i}:00`, 
      hour: i,
      value: 0 
    }));
    
    trades.forEach(trade => {
      const hour = new Date(trade.date).getHours();
      const val = metric === '$' ? trade.pnl : (trade.initialRisk ? trade.pnl / trade.initialRisk : 0);
      stats[hour].value += val;
    });
    
    // Filter to show only hours with trades
    return stats.filter(s => trades.some(t => new Date(t.date).getHours() === s.hour));
  }, [trades, metric]);

  if (trades.length === 0) {
    return (
      <div className="bg-[#121214] border border-white/5 rounded-2xl p-12 text-center text-zinc-500">
        Import trades to see performance analytics.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equity Curve */}
        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">
            Equity Curve ({metric})
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorPnL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
              />
              <YAxis 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(v) => metric === '$' ? `$${v}` : `${v}R`}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                itemStyle={{ color: '#10b981' }}
                formatter={(value: any) => [formatValue(Number(value || 0)), 'Equity']}
              />
              <Area 
                type="monotone" 
                dataKey="cumulative" 
                stroke="#10b981" 
                fillOpacity={1} 
                fill="url(#colorPnL)" 
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Daily PnL */}
        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">
            Daily Performance ({metric})
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
              />
              <YAxis 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(v) => metric === '$' ? `$${v}` : `${v}R`}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value: any) => [formatValue(Number(value || 0)), 'Performance']}
              />
              <Bar dataKey="value">
                {chartData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Day of Week Performance */}
        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">
            Performance by Day of Week ({metric})
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={dayOfWeekData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis 
                dataKey="name" 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
              />
              <YAxis 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(v) => metric === '$' ? `$${v}` : `${v}R`}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value: any) => [formatValue(Number(value || 0)), 'PnL']}
              />
              <Bar dataKey="value">
                {dayOfWeekData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Time of Day Performance */}
        <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 h-[350px]">
          <h3 className="text-sm font-semibold mb-6 text-zinc-400 uppercase tracking-wider">
            Performance by Time of Day ({metric})
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={timeOfDayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis 
                dataKey="name" 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
              />
              <YAxis 
                stroke="#52525b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(v) => metric === '$' ? `$${v}` : `${v}R`}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                formatter={(value: any) => [formatValue(Number(value || 0)), 'PnL']}
              />
              <Bar dataKey="value">
                {timeOfDayData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
