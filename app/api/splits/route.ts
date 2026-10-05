import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { fetchSplitHistory, isMassiveConfigured } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

// Split history for one ticker, used by trade charts to put raw execution prices
// on the same split-adjusted scale as Massive's candles.
export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireUser();
    if ('error' in auth) {
      const authError = auth.error;
      if (authError instanceof Response) {
        return authError;
      }
      return internalServerError();
    }

    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol')?.trim().toUpperCase();
    if (!symbol) {
      return Response.json({ error: 'Missing symbol' }, { status: 400 });
    }

    if (!isMassiveConfigured()) {
      return Response.json({ error: 'Market data provider not configured' }, { status: 503 });
    }

    try {
      const splits = await fetchSplitHistory(symbol);
      return Response.json({ symbol, splits });
    } catch (error) {
      console.error('[api:splits] upstream request failed', { symbol, error: String(error) });
      return Response.json({ error: 'Failed to fetch split history' }, { status: 502 });
    }
  } catch (error) {
    logRouteError('splits.get', error);
    return internalServerError();
  }
}
