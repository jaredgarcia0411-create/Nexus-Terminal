'use client';

import { Fragment, useMemo, useState } from 'react';
import { FileText, NotebookPen } from 'lucide-react';

import TradeTagEditor from '@/components/trading/TradeTagEditor';
import WatchlistReportInline from '@/components/trading/WatchlistReportInline';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WATCHLIST_GRADE_OPTIONS } from '@/lib/grades';
import type { Trade } from '@/lib/types';

interface WeeklyTradesPanelProps {
  trades: Trade[];
  // Header + empty-state are overridable so the same panel can serve the
  // Daily Review (passes "Daily Trades" / "No trades logged today.").
  title?: string;
  emptyState?: string;
  globalTags?: string[];
  readOnly?: boolean;
  onAddTag?: (tradeId: string, tagName: string) => void;
  onRemoveTag?: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
  grades?: Record<string, string>;
  onGradeChange?: (tradeId: string, grade: string) => void;
  reportByKey?: Map<string, string>;
  onOpenTrade?: (trade: Trade) => void;
}

interface WeeklyTradeRow {
  id: string;
  ticker: string;
  sortKey: string;
  tags: string[];
  r: number | null;
  trade: Trade;
}

// R is only meaningful when the trade has a positive initial risk.
// Mirrors the rule used in `lib/journal-aggregates.ts`.
function computeRow(trade: Trade): WeeklyTradeRow {
  const r = trade.initialRisk && trade.initialRisk > 0 ? trade.netPnl / trade.initialRisk : null;
  return {
    id: trade.id,
    ticker: trade.symbol,
    sortKey: trade.sortKey,
    tags: trade.tags ?? [],
    r,
    trade,
  };
}

function formatR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

export default function WeeklyTradesPanel({
  trades,
  title = 'Weekly Trades',
  emptyState = 'No trades logged this week.',
  globalTags = [],
  readOnly = true,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
  grades = {},
  onGradeChange,
  reportByKey,
  onOpenTrade,
}: WeeklyTradesPanelProps) {
  const [openReportKey, setOpenReportKey] = useState<string | null>(null);
  // Sort chronologically by sortKey so the order matches the Trade Replay Charts
  // section below it — same trades, same visual order.
  const rows = useMemo(
    () =>
      trades
        .slice()
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.entryTime.localeCompare(b.entryTime))
        .map(computeRow),
    [trades],
  );

  const rowCount = rows.length;
  const showEmpty = rowCount === 0;

  // Ticker · Tags · Grade · R · Report · Notes.
  // Using inline gridTemplateColumns instead of a Tailwind arbitrary class —
  // Tailwind's JIT can miss dynamic class strings in newly-added files until
  // the dev server is restarted, and we hit that here.
  const gridTemplateColumns = '80px minmax(160px, 1fr) 78px 70px 62px 62px';

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid gap-px bg-accent" style={{ gridTemplateColumns }}>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Ticker
          </div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Tags
          </div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">
            Grade
          </div>
          <div className="bg-card px-3 py-2 text-right text-xs font-semibold text-foreground">
            R
          </div>
          <div className="bg-card px-3 py-2 text-center text-xs font-semibold text-foreground">
            Report
          </div>
          <div className="bg-card px-3 py-2 text-center text-xs font-semibold text-foreground">
            Notes
          </div>

          {showEmpty ? (
            <div className="bg-card px-3 py-4 text-xs italic text-muted-foreground" style={{ gridColumn: '1 / -1' }}>
              {emptyState}
            </div>
          ) : (
            rows.map((row) => {
              const reportKey = `${row.ticker.trim().toUpperCase()}|${row.sortKey}`;
              const reportId = reportByKey?.get(reportKey);
              const reportOpen = openReportKey === reportKey;
              return (
                <Fragment key={row.id}>
                  <RowCells
                    row={row}
                    grade={grades[row.id] ?? ''}
                    globalTags={globalTags}
                    readOnly={readOnly}
                    reportId={reportId}
                    reportOpen={reportOpen}
                    onToggleReport={() => setOpenReportKey((current) => (current === reportKey ? null : reportKey))}
                    onGradeChange={onGradeChange}
                    onOpenTrade={onOpenTrade}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                    onDeleteGlobalTag={onDeleteGlobalTag}
                  />
                  {reportId && reportOpen ? (
                    <div className="bg-card p-3" style={{ gridColumn: '1 / -1' }}>
                      <WatchlistReportInline reportId={reportId} />
                    </div>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function RowCells({
  row,
  grade,
  globalTags,
  readOnly,
  reportId,
  reportOpen,
  onToggleReport,
  onGradeChange,
  onOpenTrade,
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
}: {
  row: WeeklyTradeRow;
  grade: string;
  globalTags: string[];
  readOnly: boolean;
  reportId?: string;
  reportOpen: boolean;
  onToggleReport: () => void;
  onGradeChange?: (tradeId: string, grade: string) => void;
  onOpenTrade?: (trade: Trade) => void;
  onAddTag?: (tradeId: string, tagName: string) => void;
  onRemoveTag?: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
}) {
  const cellBase = 'bg-card px-3 py-2 text-sm';
  // R color follows the same convention used elsewhere in the app:
  // green for positive, rose for negative, muted for null.
  const rColor =
    row.r === null
      ? 'text-muted-foreground'
      : row.r >= 0
        ? 'text-emerald-400'
        : 'text-rose-400';

  return (
    <>
      <div className={`${cellBase} font-medium text-foreground`}>{row.ticker}</div>
      <div className={cellBase}>
        {!readOnly && onAddTag && onRemoveTag ? (
          <TradeTagEditor
            tags={row.tags}
            globalTags={globalTags}
            onAddTag={(tag) => onAddTag(row.id, tag)}
            onRemoveTag={(tag) => onRemoveTag(row.id, tag)}
            onDeleteGlobalTag={onDeleteGlobalTag}
          />
        ) : row.tags.length > 0 ? (
          <TradeTagEditor tags={row.tags} globalTags={globalTags} readOnly emptyLabel="—" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div className={cellBase}>
        {!readOnly && onGradeChange ? (
          <Select value={grade || undefined} onValueChange={(value) => onGradeChange(row.id, value)}>
            <SelectTrigger className="h-7 w-full border-transparent bg-transparent px-1 text-sm text-foreground hover:border-emerald-500/30 hover:bg-accent">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent className="border-border bg-card text-foreground">
              {WATCHLIST_GRADE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : grade ? (
          <span className="text-foreground">{grade}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div className={`${cellBase} text-right font-medium ${rColor}`}>
        {row.r === null ? '—' : formatR(row.r)}
      </div>
      <div className="flex items-center justify-center bg-card px-1 py-1.5">
        {reportId ? (
          <button
            type="button"
            onClick={onToggleReport}
            className={`rounded-md p-1 ${
              reportOpen ? 'bg-primary/15 text-primary' : 'text-primary hover:bg-accent hover:text-primary/80'
            }`}
            title={reportOpen ? 'Hide Report' : 'Show Report'}
            aria-label={reportOpen ? 'Hide Report' : 'Show Report'}
            aria-expanded={reportOpen}
          >
            <FileText className="h-4 w-4" />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
      <div className="flex items-center justify-center bg-card px-1 py-1.5">
        {onOpenTrade ? (
          <button
            type="button"
            onClick={() => onOpenTrade(row.trade)}
            className="rounded-md p-1 text-primary hover:bg-accent hover:text-primary/80"
            title="Open Notes"
            aria-label={`Open notes for ${row.ticker}`}
          >
            <NotebookPen className="h-4 w-4" />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </>
  );
}
