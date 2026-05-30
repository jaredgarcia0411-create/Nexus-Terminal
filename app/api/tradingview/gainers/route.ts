import { scanTradingView } from '@/lib/tradingview-client';

// TradingView screener columns returned in order — index matches d[] array.
// `close`, `change`, `volume` are session-dependent (during pre-market they reflect
// yesterday's regular session; during regular hours they reflect today's live values).
// The `premarket_*` columns reflect today's pre-market session.
// The `postmarket_*` columns reflect the most recent after-hours session — that's
// yesterday's AH (4–8 PM yesterday) until today's AH starts at 4 PM, at which
// point they switch to today's AH. For Day 1 qualification we want yesterday's
// AH (the gap heading into today's regular open), which is what `postmarket_*`
// returns from PM through to today's regular session close.
const COLUMNS = [
  'name', // 0 — ticker symbol
  'close', // 1 — TV close (session-dependent)
  'change', // 2 — % change of `close` vs prior session close
  'volume', // 3 — TV volume (session-dependent)
  'average_volume_90d_calc', // 4 — 90-day avg volume
  'market_cap_basic', // 5 — market cap
  'sector', // 6 — sector
  'premarket_close', // 7 — pre-market last price
  'premarket_change', // 8 — pre-market % change vs prior regular close
  'premarket_volume', // 9 — pre-market volume
  'postmarket_close', // 10 — most recent after-hours close
  'postmarket_change', // 11 — after-hours % change
  'postmarket_volume', // 12 — after-hours volume
];

// Day 1 qualification rules:
//   - prior regular-session close > $0.75
//   - combined previous AH + current PM volume > 1M shares
//   - best PM/AH move >= 40%
//
// Once a name passes server-side here it gets latched on the dashboard for the
// rest of the day, even if the criteria stop holding (sticky semantics).
//
// TradingView cannot filter on PM volume + AH volume, so each scan is only a
// broad PM/AH move prefilter. The final price, move, and combined-volume
// qualification happens after normalization.
const PM_GAP_THRESHOLD = 40;
const AH_GAP_THRESHOLD = 40;
const PRIOR_CLOSE_FLOOR = 0.75;
const EXTENDED_HOURS_VOLUME_FLOOR = 1_000_000;

function scanBody(changeColumn: 'premarket_change' | 'postmarket_change', threshold: number) {
  return {
    columns: COLUMNS,
    filter: [
      { left: changeColumn, operation: 'egreater', right: threshold },
    ],
    sort: { sortBy: changeColumn, sortOrder: 'desc' },
    range: [0, 250],
  };
}

const PM_SCAN_BODY = scanBody('premarket_change', PM_GAP_THRESHOLD);
const AH_SCAN_BODY = scanBody('postmarket_change', AH_GAP_THRESHOLD);

export interface TradingViewGainer {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketVolume: number | null;
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketVolume: number | null;
  extendedHoursVolume: number;
  priorDayClose: number | null;
  dayOneMovePercent: number;
  dayOneMark: number;
  dayOneMoveSource: 'pre-market' | 'after-hours';
}

export interface DashboardGainersPayload {
  gainers: TradingViewGainer[];
  count: number;
  totalCount: number;
  isRealtime: boolean;
  fetchedAt: string;
}

function toNum(d: unknown[], idx: number) {
  return d[idx] != null && Number.isFinite(Number(d[idx])) ? Number(d[idx]) : null;
}

function safeVolume(value: number | null) {
  return value != null && Number.isFinite(value) ? value : 0;
}

function bestMove(
  preMarketChange: number | null,
  postMarketChange: number | null,
): { percent: number; source: TradingViewGainer['dayOneMoveSource'] } {
  const pm = preMarketChange != null && Number.isFinite(preMarketChange) ? preMarketChange : Number.NEGATIVE_INFINITY;
  const ah = postMarketChange != null && Number.isFinite(postMarketChange) ? postMarketChange : Number.NEGATIVE_INFINITY;

  if (pm >= ah) {
    return { percent: pm, source: 'pre-market' };
  }
  return { percent: ah, source: 'after-hours' };
}

function derivedPriorClose(mark: number, movePercent: number) {
  const denominator = 1 + movePercent / 100;
  if (denominator <= 0) return null;

  const priorClose = mark / denominator;
  return Number.isFinite(priorClose) ? priorClose : null;
}

function normalizeTradingViewRow(row: { s: string; d: unknown[] }): TradingViewGainer | null {
  // row.s is "EXCHANGE:TICKER" — strip the exchange prefix
  const ticker = (row.s ?? '').split(':')[1];
  if (!ticker) return null;

  const d = row.d;
  const price = Number(d[1]);

  // Skip rows without a usable close/price anchor.
  if (!Number.isFinite(price)) return null;

  const regularChange = toNum(d, 2);
  const regularVolume = toNum(d, 3);
  const preMarketPrice = toNum(d, 7);
  const preMarketChange = toNum(d, 8);
  const preMarketVolume = toNum(d, 9);
  const postMarketPrice = toNum(d, 10);
  const postMarketChange = toNum(d, 11);
  const postMarketVolume = toNum(d, 12);
  const extendedHoursVolume = safeVolume(preMarketVolume) + safeVolume(postMarketVolume);
  const move = bestMove(preMarketChange, postMarketChange);
  const dayOneMark = move.source === 'pre-market'
    ? preMarketPrice ?? price
    : postMarketPrice ?? price;
  const priorDayClose = derivedPriorClose(dayOneMark, move.percent) ?? price;

  return {
    ticker,
    price,
    change: regularChange ?? move.percent,
    volume: regularVolume ?? extendedHoursVolume,
    avgVolume90d: toNum(d, 4),
    marketCap: toNum(d, 5),
    sector: typeof d[6] === 'string' && d[6].trim() ? d[6].trim() : null,
    preMarketPrice,
    preMarketChange,
    preMarketVolume,
    postMarketPrice,
    postMarketChange,
    postMarketVolume,
    extendedHoursVolume,
    priorDayClose,
    dayOneMovePercent: move.percent,
    dayOneMark,
    dayOneMoveSource: move.source,
  };
}

function qualifiesDayOne(row: TradingViewGainer) {
  return row.priorDayClose !== null
    && row.priorDayClose > PRIOR_CLOSE_FLOOR
    && row.dayOneMovePercent >= PM_GAP_THRESHOLD
    && row.extendedHoursVolume > EXTENDED_HOURS_VOLUME_FLOOR;
}

function richerGainer(a: TradingViewGainer, b: TradingViewGainer) {
  const aScore = [
    a.preMarketPrice,
    a.preMarketChange,
    a.preMarketVolume,
    a.postMarketPrice,
    a.postMarketChange,
    a.postMarketVolume,
  ].filter((value) => value != null).length;
  const bScore = [
    b.preMarketPrice,
    b.preMarketChange,
    b.preMarketVolume,
    b.postMarketPrice,
    b.postMarketChange,
    b.postMarketVolume,
  ].filter((value) => value != null).length;

  if (b.dayOneMovePercent !== a.dayOneMovePercent) {
    return b.dayOneMovePercent > a.dayOneMovePercent ? b : a;
  }
  if (b.extendedHoursVolume !== a.extendedHoursVolume) {
    return b.extendedHoursVolume > a.extendedHoursVolume ? b : a;
  }
  return bScore > aScore ? b : a;
}

export async function fetchGainersForDashboard(): Promise<DashboardGainersPayload> {
  const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';

  const [pmPayload, ahPayload] = await Promise.all([
    scanTradingView(PM_SCAN_BODY),
    scanTradingView(AH_SCAN_BODY),
  ]);

  const byTicker = new Map<string, TradingViewGainer>();
  for (const row of [...(pmPayload.data ?? []), ...(ahPayload.data ?? [])]) {
    const normalized = normalizeTradingViewRow(row);
    if (!normalized || !qualifiesDayOne(normalized)) continue;

    const existing = byTicker.get(normalized.ticker);
    byTicker.set(normalized.ticker, existing ? richerGainer(existing, normalized) : normalized);
  }

  const gainers = Array.from(byTicker.values()).sort((a, b) => (
    b.dayOneMovePercent - a.dayOneMovePercent
    || b.extendedHoursVolume - a.extendedHoursVolume
    || a.ticker.localeCompare(b.ticker)
  ));

  return {
    gainers,
    count: gainers.length,
    totalCount: (pmPayload.totalCount ?? pmPayload.data?.length ?? 0)
      + (ahPayload.totalCount ?? ahPayload.data?.length ?? 0),
    isRealtime: Boolean(sessionId),
    fetchedAt: new Date().toISOString(),
  };
}
