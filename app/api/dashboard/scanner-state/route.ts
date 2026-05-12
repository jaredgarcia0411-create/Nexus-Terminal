import {
  fetchMdrRecentForDashboard,
  type DashboardMdrRecentPayload,
} from '@/app/api/scanner/mdr-recent/route';
import {
  fetchGainersForDashboard,
  type DashboardGainersPayload,
} from '@/app/api/tradingview/gainers/route';
import {
  fetchMdrCandidatesForDashboard,
  type DashboardMdrCandidatesPayload,
} from '@/app/api/tradingview/mdr-candidates/route';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AggregatePayload {
  gainers: DashboardGainersPayload['gainers'];
  isRealtime: boolean;
  mdrLive: DashboardMdrCandidatesPayload['candidates'];
  mdrRecent: DashboardMdrRecentPayload['rows'];
  fetchedAt: string;
}

interface CachedState {
  payload: AggregatePayload;
  expiresAt: number;
}

const TTL_MS = 8_000;
const CACHE_KEY = 'dashboard-scanner-state';
const cache = new Map<string, CachedState>();

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  const now = Date.now();
  const cached = cache.get(CACHE_KEY);
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.payload);
  }

  try {
    const [gainersResult, mdrLiveResult, mdrRecentResult] = await Promise.allSettled([
      fetchGainersForDashboard(),
      fetchMdrCandidatesForDashboard(),
      fetchMdrRecentForDashboard(db),
    ]);

    if (gainersResult.status === 'rejected') {
      console.warn('[dashboard:scanner-state] gainers fetch failed:', gainersResult.reason);
    }
    if (mdrLiveResult.status === 'rejected') {
      console.warn('[dashboard:scanner-state] mdr-candidates fetch failed:', mdrLiveResult.reason);
    }
    if (mdrRecentResult.status === 'rejected') {
      console.warn('[dashboard:scanner-state] mdr-recent fetch failed:', mdrRecentResult.reason);
    }

    const payload: AggregatePayload = {
      gainers: gainersResult.status === 'fulfilled' ? gainersResult.value.gainers : [],
      isRealtime: gainersResult.status === 'fulfilled' ? gainersResult.value.isRealtime : false,
      mdrLive: mdrLiveResult.status === 'fulfilled' ? mdrLiveResult.value.candidates : [],
      mdrRecent: mdrRecentResult.status === 'fulfilled' ? mdrRecentResult.value.rows : [],
      fetchedAt: new Date().toISOString(),
    };

    cache.set(CACHE_KEY, { payload, expiresAt: now + TTL_MS });
    return Response.json(payload);
  } catch (error) {
    logRouteError('dashboard:scanner-state', error);
    return internalServerError();
  }
}
