import { internalServerError, logRouteError, normalizeTicker, TICKER_REGEX } from '@/lib/api-route-utils';
import {
  getAskEdgarSnapshotAvailability,
  getCachedTickerData,
  normalizeAskEdgarResponse,
} from '@/lib/askedgar';
import { fetchTickerDetails, fetchUnifiedSnapshot } from '@/lib/massive-market';
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
    const [result, snapshot, tickerDetails] = await Promise.all([
      getCachedTickerData(ticker),
      fetchUnifiedSnapshot([ticker]).catch(() => ({ results: [] as unknown[] })),
      fetchTickerDetails(ticker).catch(() => ({ description: null, homepageUrl: null, sicDescription: null })),
    ]);

    const availability = getAskEdgarSnapshotAvailability(result.rawData);
    if (!availability.hasUsableSnapshotData) {
      const isRateLimited = availability.failureKind === 'rate-limited';
      const retryHint = isRateLimited
        ? `Retry in about ${availability.retryAfterSeconds ?? 60} seconds.`
        : undefined;

      return Response.json(
        {
          error: isRateLimited
            ? 'AskEdgar is temporarily rate limited. Please retry this ticker shortly.'
            : 'AskEdgar did not return usable research data for this ticker right now.',
          warnings: result.warnings,
          ...(retryHint ? { retryHint } : {}),
        },
        { status: isRateLimited ? 429 : 503 },
      );
    }

    const companyName =
      (snapshot.results?.[0] as Record<string, unknown> | undefined)?.name as string | undefined ?? null;

    const normalized = normalizeAskEdgarResponse(result.rawData, {
      ticker,
      companyName,
      fetchedAt: result.fetchedAt,
      warnings: result.warnings,
      description: tickerDetails.description,
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
