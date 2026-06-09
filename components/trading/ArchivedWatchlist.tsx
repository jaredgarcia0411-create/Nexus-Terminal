'use client';

import { Fragment, useState } from 'react';
import { FileText } from 'lucide-react';

import { TAG_TEXT_CLASS } from '@/components/trading/TradeTagEditor';
import WatchlistReportInline from '@/components/trading/WatchlistReportInline';
import type { WatchlistRow } from '@/lib/watchlist';

interface ArchivedWatchlistProps {
  rows: WatchlistRow[];
}

export default function ArchivedWatchlist({ rows }: ArchivedWatchlistProps) {
  const [openReportRowId, setOpenReportRowId] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const gridTemplateColumns = '80px minmax(140px, 1fr) 70px minmax(140px, 1fr) 62px';

  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-foreground">
        Watchlist (archived) · {rows.length}
      </summary>
      <div className="border-t border-border">
        <div className="grid gap-px bg-accent" style={{ gridTemplateColumns }}>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">Ticker</div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">Tags</div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">Grade</div>
          <div className="bg-card px-3 py-2 text-xs font-semibold text-foreground">Notes</div>
          <div className="bg-card px-3 py-2 text-center text-xs font-semibold text-foreground">Report</div>

          {rows.map((row) => {
            const reportOpen = openReportRowId === row.id;
            return (
              <Fragment key={row.id}>
                <div className="bg-card px-3 py-2 text-sm font-medium text-foreground">
                  {row.ticker || '—'}
                </div>
                <div className="bg-card px-3 py-2">
                  {row.tags.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {row.tags.map((tag) => (
                        <span key={tag} className={TAG_TEXT_CLASS}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
                <div className="bg-card px-3 py-2 text-sm text-foreground">
                  {row.grade || '—'}
                </div>
                <div className="bg-card px-3 py-2 text-sm text-foreground">
                  {row.notes.trim() || '—'}
                </div>
                <div className="flex items-center justify-center bg-card px-1 py-1.5">
                  {row.reportId ? (
                    <button
                      type="button"
                      onClick={() => setOpenReportRowId((current) => (current === row.id ? null : row.id))}
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
                {row.reportId && reportOpen ? (
                  <div className="bg-card p-3" style={{ gridColumn: '1 / -1' }}>
                    <WatchlistReportInline reportId={row.reportId} />
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>
    </details>
  );
}
