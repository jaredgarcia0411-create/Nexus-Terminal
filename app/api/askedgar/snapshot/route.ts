import { internalServerError, logRouteError, normalizeTicker, TICKER_REGEX } from '@/lib/api-route-utils';
import { getCachedTickerData, normalizeAskEdgarResponse } from '@/lib/askedgar';
import { fetchUnifiedSnapshot } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const url = new URL(request.url);
  const ticker = normalizeTicker(url.searchParams.get('ticker') ?? undefined);

  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return Response.json({ error: 'Valid ticker parameter required' }, { status: 400 });
  }

  try {
    const [result, snapshot] = await Promise.all([
      getCachedTickerData(ticker),
      fetchUnifiedSnapshot([ticker]).catch(() => ({ results: [] as unknown[] })),
    ]);

    const companyName =
      (snapshot.results?.[0] as Record<string, unknown> | undefined)?.name as string | undefined ?? null;

    const normalized = normalizeAskEdgarResponse(result.rawData, {
      ticker,
      companyName,
      fetchedAt: result.fetchedAt,
      warnings: result.warnings,
    });

    // Strip rawData — it's the full 16-endpoint payload used server-side by the research pipeline.
    // Components only need the normalized fields, so we don't send it to the browser.
    const { rawData: _, ...clientSafe } = normalized;
    return Response.json(clientSafe);
  } catch (error) {
    logRouteError('askedgar-snapshot', error);
    return internalServerError();
  }
}
