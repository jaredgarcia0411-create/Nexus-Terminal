import Papa from 'papaparse';
import type { Direction, Trade } from '@/lib/types';

// TraderVue exports one fully-aggregated trade per row (no per-fill data),
// so this importer skips the execution-matching pipeline and produces Trade[]
// directly. Columns we use are read case-insensitively from the header row.

const REQUIRED_HEADERS = ['Open Datetime', 'Close Datetime', 'Symbol', 'Side', 'Volume', 'Entry Price', 'Exit Price'];

type RowMap = Record<string, string>;

function readCell(row: RowMap, header: string): string {
  const target = header.trim().toLowerCase();
  for (const [key, value] of Object.entries(row)) {
    if (key.trim().toLowerCase() === target) return value ?? '';
  }
  return '';
}

function parseNumber(value: string): number {
  if (value == null) return 0;
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  const parsed = parseFloat(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value: string): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

// TraderVue format is "YYYY-MM-DD HH:MM:SS" in the exporter's local timezone.
// We split on the space rather than calling new Date(s) so the date and the
// time-of-day stay aligned with what the user sees in TV's UI (no TZ shift).
function splitDateTime(value: string): { sortKey: string; time: string } | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const [datePart, timePart = ''] = trimmed.split(/[T ]/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const time = timePart.split('.')[0] || '00:00:00';
  return { sortKey: datePart, time };
}

function buildDate(sortKey: string, time: string): Date {
  const [y, m, d] = sortKey.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = time.split(':').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm, ss);
}

function parseDirection(rawSide: string): Direction | null {
  const upper = String(rawSide ?? '').trim().toUpperCase();
  if (upper === 'L' || upper === 'LONG' || upper === 'B') return 'LONG';
  if (upper === 'S' || upper === 'SHORT' || upper === 'SS') return 'SHORT';
  return null;
}

function parseTags(raw: string): string[] {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  return trimmed
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function detectTraderVueHeaders(headers: string[]): boolean {
  const lower = headers.map((h) => h.trim().toLowerCase());
  return REQUIRED_HEADERS.every((req) => lower.includes(req.toLowerCase()));
}

export async function parseTraderVueCsv(file: File): Promise<{ trades: Trade[]; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<RowMap>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const warnings: string[] = [];
        const rows = (results.data ?? []) as RowMap[];
        const headers = results.meta?.fields ?? [];

        if (!detectTraderVueHeaders(headers)) {
          reject(new Error(
            "This CSV doesn't look like a TraderVue export. Expected columns like \"Open Datetime\", \"Close Datetime\", \"Symbol\", \"Side\", \"Volume\".",
          ));
          return;
        }

        const trades: Trade[] = [];

        rows.forEach((row, index) => {
          const symbol = String(readCell(row, 'Symbol') ?? '').trim().toUpperCase();
          if (!symbol) return; // ignore blank rows silently

          const open = splitDateTime(readCell(row, 'Open Datetime'));
          const close = splitDateTime(readCell(row, 'Close Datetime'));
          if (!open) {
            warnings.push(`Row ${index + 2}: missing/invalid "Open Datetime" — skipped`);
            return;
          }
          if (!close) {
            warnings.push(`Row ${index + 2}: ${symbol} has no "Close Datetime" (open position?) — skipped`);
            return;
          }

          const direction = parseDirection(readCell(row, 'Side'));
          if (!direction) {
            warnings.push(`Row ${index + 2}: ${symbol} has unknown Side "${readCell(row, 'Side')}" — skipped`);
            return;
          }

          const totalQuantity = parseNumber(readCell(row, 'Volume'));
          const avgEntryPrice = parseNumber(readCell(row, 'Entry Price'));
          const avgExitPrice = parseNumber(readCell(row, 'Exit Price'));
          if (totalQuantity <= 0 || avgEntryPrice <= 0 || avgExitPrice <= 0) {
            warnings.push(`Row ${index + 2}: ${symbol} has zero/negative qty or price — skipped`);
            return;
          }

          // Prefer explicit Gross/Net P&L; only fall back to a computed value if
          // both are blank, since TV's numbers already include rounding TV uses.
          const grossPnlRaw = parseOptionalNumber(readCell(row, 'Gross P&L'));
          const netPnlRaw = parseOptionalNumber(readCell(row, 'Net P&L'));
          const commission = parseNumber(readCell(row, 'Commissions'));
          const fees = parseNumber(readCell(row, 'Fees'));

          const computedGross = direction === 'LONG'
            ? (avgExitPrice - avgEntryPrice) * totalQuantity
            : (avgEntryPrice - avgExitPrice) * totalQuantity;
          const grossPnl = grossPnlRaw ?? computedGross;
          const netPnl = netPnlRaw ?? grossPnl - commission - fees;

          const executionCount = Math.max(1, Math.round(parseNumber(readCell(row, 'Exec Count')) || 1));
          const initialRiskRaw = parseNumber(readCell(row, 'Initial Risk'));
          const initialRisk = initialRiskRaw > 0 ? initialRiskRaw : undefined;

          const mfe = parseOptionalNumber(readCell(row, 'Position MFE'));
          const mae = parseOptionalNumber(readCell(row, 'Position MAE'));
          const bestExitPnl = parseOptionalNumber(readCell(row, 'Best Exit P&L'));

          // Exit efficiency: how close net P&L came to the best possible exit.
          // (netPnl / bestExitPnl) only makes sense when bestExitPnl is positive
          // and the trade was profitable; otherwise leave it unset.
          const exitEfficiency = bestExitPnl != null && bestExitPnl > 0 && netPnl > 0
            ? Math.min(1, netPnl / bestExitPnl)
            : undefined;

          const notesRaw = String(readCell(row, 'Notes') ?? '').trim();
          const tags = parseTags(readCell(row, 'Tags'));

          // ID includes entry time-of-day so two trades on the same day with the
          // same direction stay distinct; re-importing the same export upserts.
          const id = `tv:${open.sortKey}:${symbol}:${direction}:${open.time}`;

          trades.push({
            id,
            date: buildDate(open.sortKey, open.time),
            sortKey: open.sortKey,
            symbol,
            direction,
            avgEntryPrice,
            avgExitPrice,
            totalQuantity,
            grossPnl,
            netPnl,
            entryTime: open.time,
            exitTime: close.time,
            executionCount,
            rawExecutions: [],
            pnl: netPnl,
            executions: executionCount,
            mfe: mfe ?? undefined,
            mae: mae ?? undefined,
            bestExitPnl: bestExitPnl ?? undefined,
            exitEfficiency,
            initialRisk,
            commission,
            fees,
            tags,
            notes: notesRaw.length > 0 ? notesRaw : undefined,
          });
        });

        resolve({ trades, warnings });
      },
      error: (parseError) => reject(parseError),
    });
  });
}
