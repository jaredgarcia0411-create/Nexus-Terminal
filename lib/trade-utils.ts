import Papa from 'papaparse';
import { parseDateFromFilename, processCsvData } from '@/lib/csv-parser';
import type { BrokerParserConfig } from '@/lib/parsers';
import type { ApiTrade, Trade } from '@/lib/types';

export type CsvParseIssue = { row?: number; message?: string; code?: string };

export type TradeLike = Partial<Omit<Trade, 'date'>> & {
  id: string;
  date: string | Date;
  sortKey: string;
  symbol: string;
  direction: Trade['direction'];
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
};

type ApiRequestError = Error & { status?: number };

export const normalizeTrade = (trade: TradeLike): Trade => {
  const commission = trade.commission ?? 0;
  const fees = trade.fees ?? 0;
  const netPnl = trade.netPnl ?? trade.pnl ?? 0;
  const grossPnl = trade.grossPnl ?? netPnl + commission + fees;
  const legacyExecutionCount = (trade as unknown as Record<string, unknown>)['executions'];
  const executionCount = trade.executionCount ?? (typeof legacyExecutionCount === 'number' ? legacyExecutionCount : 1);

  return {
    ...trade,
    date: new Date(trade.date),
    grossPnl,
    netPnl,
    entryTime: trade.entryTime ?? '',
    exitTime: trade.exitTime ?? '',
    executionCount,
    rawExecutions: trade.rawExecutions ?? [],
    pnl: netPnl,
    executions: executionCount,
    tags: trade.tags ?? [],
    isOpen: trade.isOpen ?? false,
    remainingQty: trade.remainingQty ?? 0,
  };
};

export const sortTradesByDate = (list: Trade[]): Trade[] =>
  [...list].sort((a, b) => b.date.getTime() - a.date.getTime());

export const toApiTrade = (trade: Trade): ApiTrade => ({
  ...trade,
  pnl: trade.netPnl,
  executions: trade.executionCount,
  date: new Date(trade.date).toISOString(),
});

export const fromApiTrade = (trade: ApiTrade): Trade => normalizeTrade(trade);

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string; details?: string; code?: string };
  if (!res.ok) {
    const base = data.error || 'Something went wrong';
    const code = typeof data.code === 'string' && data.code ? ` [${data.code}]` : '';
    const details = typeof data.details === 'string' && data.details ? `: ${data.details}` : '';
    const error = new Error(`${base}${code}${details}`) as ApiRequestError;
    error.status = res.status;
    throw error;
  }

  return data;
}

export function appendCsvParseWarnings(fileName: string, issues: CsvParseIssue[], warnings: string[]) {
  for (const issue of issues) {
    const row = typeof issue.row === 'number' ? ` row ${issue.row + 1}` : '';
    const code = issue.code ? ` (${issue.code})` : '';
    const message = issue.message?.trim() || 'Unknown CSV parse error';
    warnings.push(`${fileName}${row}: ${message}${code}`);
  }
}

type CollectImportedTradesOptions = {
  includeFile?: (file: File) => boolean;
  resolveParser: (file: File, rows: Record<string, string>[]) => BrokerParserConfig | null;
};

export async function collectImportedTrades(
  files: FileList,
  options: CollectImportedTradesOptions,
): Promise<{ trades: Trade[]; processedDates: Set<string>; warnings: string[] }> {
  const trades: Trade[] = [];
  const processedDates = new Set<string>();
  const warnings: string[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (options.includeFile && !options.includeFile(file)) continue;

    const dateInfo = parseDateFromFilename(file.name);
    if (!dateInfo) {
      warnings.push(`Skipped ${file.name}: could not parse date from filename`);
      continue;
    }

    await new Promise<void>((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const rows = results.data as Record<string, string>[];
            const parseIssues = (results.errors ?? []) as CsvParseIssue[];
            if (parseIssues.length > 0) appendCsvParseWarnings(file.name, parseIssues, warnings);

            const parser = options.resolveParser(file, rows);
            const parsed = processCsvData(rows, dateInfo, parser && parser.id !== 'default' ? parser : undefined);

            if (parsed.trades.length > 0) processedDates.add(dateInfo.sortKey);
            trades.push(...parsed.trades);
            warnings.push(...parsed.warnings);
            resolve();
          } catch (parseError) {
            reject(parseError);
          }
        },
        error: (parseError) => reject(parseError),
      });
    });
  }

  return { trades, processedDates, warnings };
}
