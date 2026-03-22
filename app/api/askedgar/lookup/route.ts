import { getCachedTickerData } from '@/lib/jarvis/askedgar';
import { fetchUnifiedSnapshot } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

const TICKER_REGEX = /^[A-Z0-9.\-^]{1,10}$/;

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.trim().toUpperCase();

  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return Response.json({ error: 'Valid ticker parameter required' }, { status: 400 });
  }

  try {
    const [result, snapshot] = await Promise.all([
      getCachedTickerData(ticker),
      fetchUnifiedSnapshot([ticker]).catch(() => ({ results: [] as unknown[] })),
    ]);

    const companyName = (snapshot.results?.[0] as Record<string, unknown> | undefined)?.name as string | undefined ?? null;

    return Response.json({ ...result, companyName });
  } catch (error) {
    console.error('[askedgar-lookup]', error);
    return Response.json({ error: 'Ask Edgar lookup failed' }, { status: 500 });
  }
}
