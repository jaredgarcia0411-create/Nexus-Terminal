import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { evaluateLatestD2MdrTrigger } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COLUMNS = [
  'name',
  'close',
  'change',
  'volume',
  'average_volume_90d_calc',
  'market_cap_basic',
  'sector',
  'premarket_close',
  'premarket_change',
  'premarket_volume',
];

// MDR-aligned filter set — mirrors the Python d2_mdr precondition stack
// (close >= $1, vol >= 10M, regular-session change >= 20%) so anything
// passing the Python scan also passes this gate.
const SCAN_BODY = {
  columns: COLUMNS,
  filter: [
    { left: 'close', operation: 'egreater', right: 1 },
    { left: 'volume', operation: 'egreater', right: 10_000_000 },
    { left: 'change', operation: 'egreater', right: 20 },
    { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE'] },
  ],
  sort: { sortBy: 'change', sortOrder: 'desc' },
  range: [0, 100],
};

const CANDIDATE_CONCURRENCY = 10;

export interface MdrCandidate {
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
  pmPriceNeeded: number | null;
  openingGapNeededPercent: number | null;
  intradayPriceNeeded: number | null;
  basisPrice: number | null;
  atr14: number | null;
}

type NormalizedMdrCandidate = Omit<
  MdrCandidate,
  'pmPriceNeeded' | 'openingGapNeededPercent' | 'intradayPriceNeeded' | 'basisPrice' | 'atr14'
>;

export interface DashboardMdrCandidatesPayload {
  candidates: MdrCandidate[];
  count: number;
  totalCount: number;
  isRealtime: boolean;
  fetchedAt: string;
}

async function structurallyQualifyCandidates(candidates: NormalizedMdrCandidate[]): Promise<MdrCandidate[]> {
  const qualified: MdrCandidate[] = [];

  for (let i = 0; i < candidates.length; i += CANDIDATE_CONCURRENCY) {
    const chunk = candidates.slice(i, i + CANDIDATE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (candidate) => {
        const evaluation = await evaluateLatestD2MdrTrigger(candidate.ticker);
        if (!evaluation.triggered) return null;

        return {
          ...candidate,
          pmPriceNeeded: evaluation.thresholds.pmPriceNeeded,
          openingGapNeededPercent: evaluation.thresholds.openingGapNeededPercent,
          intradayPriceNeeded: evaluation.thresholds.intradayPriceNeeded,
          basisPrice: evaluation.thresholds.basisPrice,
          atr14: evaluation.thresholds.atr14,
        } satisfies MdrCandidate;
      }),
    );

    for (let j = 0; j < settled.length; j += 1) {
      const result = settled[j];
      if (result.status === 'fulfilled') {
        if (result.value) qualified.push(result.value);
        continue;
      }

      const ticker = chunk[j]?.ticker ?? 'UNKNOWN';
      console.warn('[api:tradingview-mdr-candidates] skipped structural evaluation', {
        ticker,
        reason: result.reason instanceof Error ? result.reason.message : 'unknown',
      });
    }
  }

  return qualified;
}

export async function fetchMdrCandidatesForDashboard(): Promise<DashboardMdrCandidatesPayload> {
  const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';

  const response = await fetch('https://scanner.tradingview.com/america/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { Cookie: `sessionid=${sessionId}` } : {}),
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://www.tradingview.com',
      Referer: 'https://www.tradingview.com/',
    },
    body: JSON.stringify(SCAN_BODY),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`TradingView scanner returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    totalCount?: number;
    data?: Array<{ s: string; d: unknown[] }>;
  };

  const raw = payload.data ?? [];

  const normalizedCandidates: NormalizedMdrCandidate[] = raw.flatMap((row) => {
    const ticker = (row.s ?? '').split(':')[1];
    if (!ticker) return [];

    const d = row.d;
    const price = Number(d[1]);
    const change = Number(d[2]);
    const volume = Number(d[3]);
    if (!Number.isFinite(price) || !Number.isFinite(change) || !Number.isFinite(volume)) return [];

    const toNum = (idx: number) =>
      d[idx] != null && Number.isFinite(Number(d[idx])) ? Number(d[idx]) : null;

    return [{
      ticker,
      price,
      change,
      volume,
      avgVolume90d: toNum(4),
      marketCap: toNum(5),
      sector: typeof d[6] === 'string' && d[6].trim() ? d[6].trim() : null,
      preMarketPrice: toNum(7),
      preMarketChange: toNum(8),
      preMarketVolume: toNum(9),
    }];
  });

  const candidates = await structurallyQualifyCandidates(normalizedCandidates);

  return {
    candidates,
    count: candidates.length,
    totalCount: payload.totalCount ?? candidates.length,
    isRealtime: Boolean(sessionId),
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  try {
    return Response.json(await fetchMdrCandidatesForDashboard());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('TradingView scanner returned ')) {
      const status = error.message.replace('TradingView scanner returned ', '');
      return Response.json(
        { error: `TradingView scanner returned ${status}` },
        { status: 502 },
      );
    }

    logRouteError('tradingview-mdr-candidates', error);
    return internalServerError();
  }
}
