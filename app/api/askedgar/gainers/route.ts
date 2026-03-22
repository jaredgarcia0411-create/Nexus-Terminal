import { fetchTopGainers } from '@/lib/jarvis/askedgar';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

let cache: { data: unknown; expiry: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const url = new URL(request.url);
  const minGain = Number(url.searchParams.get('min_gain') ?? '20');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '25'), 50);

  if (cache && Date.now() < cache.expiry) {
    return Response.json(cache.data);
  }

  try {
    // Over-fetch since we'll filter some out by prior close
    const result = await fetchTopGainers(
      Number.isFinite(minGain) && minGain > 0 ? minGain : 20,
      Number.isFinite(limit) && limit > 0 ? limit * 2 : 50,
    );

    // Filter to stocks with prior close >= $0.75
    // prior_close = current_price / (1 + gain_pct / 100)
    const MIN_PRIOR_CLOSE = 0.75;
    const filtered = (result.results as Array<Record<string, unknown>>).filter((gainer) => {
      const price = Number(gainer.price);
      const gain = Number(gainer.gain_1_day);
      if (!Number.isFinite(price) || !Number.isFinite(gain)) return false;
      const priorClose = price / (1 + gain / 100);
      return priorClose >= MIN_PRIOR_CLOSE;
    }).slice(0, limit);

    const responseData = {
      gainers: filtered,
      count: filtered.length,
      fetchedAt: new Date().toISOString(),
    };

    cache = { data: responseData, expiry: Date.now() + CACHE_TTL_MS };

    return Response.json(responseData);
  } catch (error) {
    console.error('[askedgar-gainers]', error);
    return Response.json({ error: 'Failed to fetch gainers' }, { status: 500 });
  }
}
