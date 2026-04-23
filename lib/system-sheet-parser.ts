import Papa from 'papaparse';

export interface SystemStage {
  [field: string]: string | number | null;
}

export interface SystemAttempt {
  attemptIndex: number;
  triggerType: string | null;
  starter: SystemStage;
  fmTrig: SystemStage;
  fmTrigSub30: SystemStage;
  popVwap: SystemStage;
  fmCloseSubPiv: SystemStage;
  exit: SystemStage;
}

export interface ParsedSystemRow {
  ticker: string;
  date: string;
  grade: string | null;
  primaryAgenda: string | null;
  secondaryAgenda: string | null;
  setupType: string | null;
  outcome: string | null;
  tickerWinLoss: string | null;
  tickerR: number | null;
  triggerCount: number | null;
  day1GapPct: number | null;
  attempts: SystemAttempt[];
  rawJson: Record<string, string | null>;
}

export interface ParsedSystemSheet {
  rows: ParsedSystemRow[];
  warnings: string[];
}

// Column positions (0-indexed) from "Agenda Database V3 - MAXIMILLION".
// Ticker-level block: cols 0..26.
// Trigger-attempt block: cols 27..72 (46 cols), repeated 4 times for attempts 1..4.
const TICKER_LEVEL_COLS = 27;
const ATTEMPT_BLOCK_WIDTH = 46;

// Field offsets inside one attempt block (0..45, relative to attempt start).
// Keys match SystemAttempt stage-field names. Values are column offsets within the block.
const ATTEMPT_SCHEMA = {
  starter: {
    riskDollars: 0,
    time: 1,
    highestRetrace: 2,
    stop: 3,
    twoMPiv: 4,
    avg: 5,
    pos: 6,
    riskFinal: 7,
  },
  fmTrig: {
    triggerType: 8,
    time: 9,
    highestRetrace: 10,
    stop: 11,
    price: 12,
    addedShares: 13,
    newAvg: 14,
    newPos: 15,
    risk: 16,
  },
  fmTrigSub30: {
    time: 17,
    highestRetrace: 18,
    stop: 19,
    price: 20,
    addedShares: 21,
    newAvg: 22,
    newPos: 23,
    risk: 24,
  },
  popVwap: {
    time: 25,
    highestRetrace: 26,
    stop: 27,
    price: 28,
    addedShares: 29,
    newAvg: 30,
    newPos: 31,
    risk: 32,
  },
  fmCloseSubPiv: {
    time: 33,
    highestRetrace: 34,
    stop: 35,
    price: 36,
    addedShares: 37,
    newAvg: 38,
    newPos: 39,
  },
  exit: {
    avgWhenExit: 40,
    posWhenExit: 41,
    exitPrice: 42,
    pnl: 43,
    r: 44,
    wl: 45,
  },
} as const;

function cleanCell(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '#DIV/0!' || trimmed === '#N/A' || trimmed === '#REF!') {
    return null;
  }
  return trimmed;
}

function toNumber(raw: string | undefined | null): number | null {
  const cleaned = cleanCell(raw);
  if (cleaned == null) return null;
  const stripped = cleaned.replace(/[$,%]/g, '').replace(/\s/g, '');
  if (stripped === '' || stripped === '-') return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(raw: string | undefined | null): string | null {
  const cleaned = cleanCell(raw);
  if (cleaned == null) return null;

  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const [, m, d, yRaw] = usMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

function extractStage(
  row: string[],
  attemptBase: number,
  schema: Record<string, number>,
  numericFields: string[],
): SystemStage {
  const stage: SystemStage = {};
  for (const [field, offset] of Object.entries(schema)) {
    const cell = row[attemptBase + offset];
    if (numericFields.includes(field)) {
      stage[field] = toNumber(cell);
    } else {
      stage[field] = cleanCell(cell);
    }
  }
  return stage;
}

function hasAnyValue(stage: SystemStage): boolean {
  return Object.values(stage).some((value) => value !== null && value !== '');
}

export function parseSystemSheet(csvText: string): ParsedSystemSheet {
  const warnings: string[] = [];
  const rows: ParsedSystemRow[] = [];
  const seenKeys = new Set<string>();

  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      warnings.push(`CSV parse: row ${error.row ?? '?'} — ${error.message}`);
    }
  }

  const data = parsed.data;
  if (data.length < 2) {
    warnings.push('CSV has no data rows (expected a header row + at least one data row).');
    return { rows, warnings };
  }

  const header = data[0];
  if (header[2]?.trim() !== 'Ticker' || header[3]?.trim() !== 'Day 1 Date') {
    warnings.push(`Unexpected header layout — col 2 should be "Ticker" and col 3 should be "Day 1 Date". Got "${header[2]}" / "${header[3]}".`);
  }

  for (let i = 1; i < data.length; i += 1) {
    const row = data[i];
    const rowNum = i + 1;

    const ticker = cleanCell(row[2])?.toUpperCase() ?? null;
    if (!ticker) {
      continue;
    }

    const isoDate = toIsoDate(row[3]);
    if (!isoDate) {
      warnings.push(`Row ${rowNum} (${ticker}): invalid or missing Day 1 Date "${row[3] ?? ''}" — skipped.`);
      continue;
    }

    const key = `${ticker}|${isoDate}`;
    if (seenKeys.has(key)) {
      warnings.push(`Row ${rowNum} (${ticker}, ${isoDate}): duplicate (ticker, date) within this upload — skipped.`);
      continue;
    }
    seenKeys.add(key);

    const attempts: SystemAttempt[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const base = TICKER_LEVEL_COLS + attempt * ATTEMPT_BLOCK_WIDTH;

      const starter = extractStage(row, base, ATTEMPT_SCHEMA.starter, ['riskDollars', 'stop', 'twoMPiv', 'avg', 'pos', 'riskFinal']);
      const fmTrig = extractStage(row, base, ATTEMPT_SCHEMA.fmTrig, ['stop', 'price', 'addedShares', 'newAvg', 'newPos', 'risk']);
      const fmTrigSub30 = extractStage(row, base, ATTEMPT_SCHEMA.fmTrigSub30, ['stop', 'price', 'addedShares', 'newAvg', 'newPos', 'risk']);
      const popVwap = extractStage(row, base, ATTEMPT_SCHEMA.popVwap, ['stop', 'price', 'addedShares', 'newAvg', 'newPos', 'risk']);
      const fmCloseSubPiv = extractStage(row, base, ATTEMPT_SCHEMA.fmCloseSubPiv, ['stop', 'price', 'addedShares', 'newAvg', 'newPos']);
      const exit = extractStage(row, base, ATTEMPT_SCHEMA.exit, ['avgWhenExit', 'posWhenExit', 'exitPrice', 'pnl', 'r']);

      if (!hasAnyValue(starter) && !hasAnyValue(fmTrig) && !hasAnyValue(exit)) {
        continue;
      }

      attempts.push({
        attemptIndex: attempt + 1,
        triggerType: typeof fmTrig.triggerType === 'string' ? fmTrig.triggerType : null,
        starter,
        fmTrig,
        fmTrigSub30,
        popVwap,
        fmCloseSubPiv,
        exit,
      });
    }

    const rawJson: Record<string, string | null> = {};
    for (let col = 0; col < row.length; col += 1) {
      const headerName = header[col]?.trim() || `col_${col}`;
      const keyName = col < header.length ? headerName : `col_${col}`;
      const storedKey = rawJson[keyName] !== undefined ? `${keyName}__${col}` : keyName;
      rawJson[storedKey] = cleanCell(row[col]);
    }

    rows.push({
      ticker,
      date: isoDate,
      grade: cleanCell(row[5]),
      primaryAgenda: cleanCell(row[6]),
      secondaryAgenda: cleanCell(row[7]),
      setupType: cleanCell(row[15]),
      outcome: cleanCell(row[10]),
      tickerWinLoss: cleanCell(row[26]),
      tickerR: toNumber(row[22]),
      triggerCount: (() => {
        const n = toNumber(row[23]);
        return n == null ? null : Math.trunc(n);
      })(),
      day1GapPct: toNumber(row[12]),
      attempts,
      rawJson,
    });
  }

  return { rows, warnings };
}
