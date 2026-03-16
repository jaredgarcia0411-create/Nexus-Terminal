'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useScanner, type ScannerSortKey } from '@/hooks/use-scanner';

function formatNumber(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatChange(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatVolume(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

const COLUMNS: { key: ScannerSortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'symbol', label: 'Ticker', align: 'left' },
  { key: 'lastPrice', label: 'Price', align: 'right' },
  { key: 'netChange', label: 'Change', align: 'right' },
  { key: 'netChangePercent', label: 'Change %', align: 'right' },
  { key: 'totalVolume', label: 'Volume', align: 'right' },
];

const PAGE_SIZE = 25;

export default function ScannerSection({ refreshIntervalMs }: { refreshIntervalMs: number }) {
  const {
    filters,
    setFilters,
    sortBy,
    sortDir,
    toggleSort,
    results,
    loading,
    error,
    presets,
    presetsError,
    savePreset,
    deletePreset,
    loadPreset,
    clearFilters,
    fetchResults,
  } = useScanner(refreshIntervalMs);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);

  const updateFilter = (key: string, raw: string) => {
    const value = raw.trim();
    if (value === '') {
      setFilters((previous) => {
        const next = { ...previous };
        delete (next as Record<string, unknown>)[key];
        return next;
      });
      return;
    }
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      setFilters((previous) => ({ ...previous, [key]: numberValue }));
    }
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) {
      return;
    }
    void savePreset(name);
    setPresetName('');
  };

  const activeFilterCount = [
    filters.minPrice,
    filters.maxPrice,
    filters.minChangePercent,
    filters.maxChangePercent,
    filters.minVolume,
    filters.assetType,
  ].filter((value) => value !== undefined).length;

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = results.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [filters, sortBy, sortDir]);

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-[#121214] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-100">Scanner</h2>
          {loading ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-zinc-500">{results.length} results</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen((previous) => !previous)}
            className="border-white/10 bg-white/5 text-xs text-zinc-200 hover:bg-white/10"
          >
            Filters
            {activeFilterCount > 0 ? (
              <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 text-[10px] text-emerald-400">{activeFilterCount}</span>
            ) : null}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchResults()}
            className="border-white/10 bg-white/5 text-xs text-zinc-200 hover:bg-white/10"
          >
            Refresh
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {filtersOpen ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Min Price</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={filters.minPrice ?? ''}
                    onChange={(event) => updateFilter('minPrice', event.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Max Price</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="any"
                    value={filters.maxPrice ?? ''}
                    onChange={(event) => updateFilter('maxPrice', event.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Min Change %</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="-100"
                    value={filters.minChangePercent ?? ''}
                    onChange={(event) => updateFilter('minChangePercent', event.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Max Change %</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="any"
                    value={filters.maxChangePercent ?? ''}
                    onChange={(event) => updateFilter('maxChangePercent', event.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <label className="mb-1 block text-[11px] text-zinc-400">Min Volume</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={filters.minVolume ?? ''}
                    onChange={(event) => updateFilter('minVolume', event.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-[11px] text-zinc-400">Asset Type</label>
                  <Select
                    value={filters.assetType ?? 'all'}
                    onValueChange={(value) => {
                      if (value === 'all') {
                        setFilters((previous) => {
                          const next = { ...previous };
                          delete next.assetType;
                          return next;
                        });
                      } else {
                        setFilters((previous) => ({ ...previous, assetType: value }));
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="equity">Equity</SelectItem>
                      <SelectItem value="etf">ETF</SelectItem>
                      <SelectItem value="future">Future</SelectItem>
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="index">Index</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Clear
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
                <span className="text-[11px] text-zinc-500">Presets:</span>
                {presets.map((preset) => (
                  <div key={preset.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => loadPreset(preset)}
                      className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/10"
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deletePreset(preset.id)}
                      className="text-[10px] text-zinc-500 hover:text-rose-400"
                      title="Delete preset"
                    >
                      x
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    type="text"
                    placeholder="Preset name"
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleSavePreset();
                      }
                    }}
                    className="h-6 w-28 border-white/10 bg-white/5 text-[11px] text-zinc-200"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSavePreset}
                    disabled={!presetName.trim()}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300"
                  >
                    Save
                  </Button>
                </div>
              </div>

              {presetsError ? (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {presetsError}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full tabular-nums text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-zinc-400">
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={`cursor-pointer select-none px-2 py-2 hover:text-zinc-200 ${column.align === 'right' ? 'text-right' : ''}`}
                  onClick={() => toggleSort(column.key)}
                >
                  {column.label}
                  {sortBy === column.key ? (
                    <span className="ml-1 text-emerald-400">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const positive = (row.netChangePercent ?? 0) >= 0;
              return (
                <tr key={row.symbol} className="border-b border-white/5 text-zinc-200">
                  <td className="px-2 py-2 font-medium">{row.symbol}</td>
                  <td className="px-2 py-2 text-right">{formatNumber(row.lastPrice)}</td>
                  <td className={`px-2 py-2 text-right ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {formatChange(row.netChange)}
                  </td>
                  <td className={`px-2 py-2 text-right ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {formatPercent(row.netChangePercent)}
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-400">{formatVolume(row.totalVolume)}</td>
                </tr>
              );
            })}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-zinc-500">
                  {loading
                    ? 'Loading...'
                    : error
                      ? 'Scanner unavailable'
                      : activeFilterCount > 0
                        ? 'No results match your filters.'
                        : 'No realtime quotes available. Scanner requires a live Schwab connection - check Markets tab for status.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-zinc-500">Page {safePage} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              disabled={safePage <= 1}
              className="rounded border border-white/15 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
              disabled={safePage >= totalPages}
              className="rounded border border-white/15 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
