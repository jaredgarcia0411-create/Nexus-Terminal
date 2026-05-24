import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { fetchHistoricalDilutionRating, extractRetryAfterSeconds, isRateLimitError } from '@/lib/askedgar/endpoints';
import { getDb } from '@/lib/db';
import { askedgarCache } from '@/lib/db/schema';
import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HISTORICAL_DILUTION_RATING_CACHE_TYPE = 'historical-dilution-rating';
const HISTORICAL_DILUTION_RATING_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const querySchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/, 'Invalid ticker'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').refine((value) => {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return false;
    const tenYearsAgo = Date.now() - 10 * 365 * 86_400_000;
    return parsed >= tenYearsAgo && parsed <= Date.now();
  }, 'Date must be within the last 10 years and not in the future'),
});

function cacheKey(ticker: string, date: string) {
  return `${ticker}:${date}`;
}

function responseForRateLimit(error: string, warnings: string[]) {
  const retryAfterSeconds = extractRetryAfterSeconds(error) ?? 60;
  return Response.json({
    error: 'AskEdgar is temporarily rate limited. Please retry this ticker shortly.',
    warnings,
    retryHint: `Retry in about ${retryAfterSeconds} seconds.`,
  }, { status: 429 });
}

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  const url = new URL(request.url);
  const normalizedTicker = (url.searchParams.get('ticker') ?? '').trim().toUpperCase();
  const date = (url.searchParams.get('date') ?? '').trim();
  const parsed = querySchema.safeParse({ ticker: normalizedTicker, date });
  if (!parsed.success) {
    return Response.json({
      error: 'Validation failed',
      details: z.flattenError(parsed.error),
    }, { status: 400 });
  }

  const key = cacheKey(parsed.data.ticker, parsed.data.date);

  try {
    const now = new Date();
    const cached = await db
      .select()
      .from(askedgarCache)
      .where(
        and(
          eq(askedgarCache.cacheType, HISTORICAL_DILUTION_RATING_CACHE_TYPE),
          eq(askedgarCache.ticker, key),
          gt(askedgarCache.expiresAt, now),
        ),
      )
      .limit(1);

    if (cached.length > 0) {
      return Response.json(cached[0].dataJson);
    }

    const rating = await fetchHistoricalDilutionRating(parsed.data.ticker, parsed.data.date);
    const warnings = rating.error ? [`Historical Dilution Rating unavailable: ${rating.error}`] : [];

    if (rating.status === 'error') {
      if (isRateLimitError(rating.error)) {
        return responseForRateLimit(rating.error ?? 'Rate limited', warnings);
      }

      return Response.json({
        error: rating.error ?? 'AskEdgar did not return historical dilution data for this ticker right now.',
        warnings,
      }, { status: 503 });
    }

    console.log(
      `[historical-dilution-rating] ticker=${parsed.data.ticker} date=${parsed.data.date} costMicrodollars=${rating.usage?.cost_microdollars ?? 0}`,
    );

    const payload = {
      ticker: parsed.data.ticker,
      date: parsed.data.date,
      rating,
    };

    try {
      const expiresAt = new Date(now.getTime() + HISTORICAL_DILUTION_RATING_CACHE_TTL_MS);
      await db
        .insert(askedgarCache)
        .values({
          id: `${HISTORICAL_DILUTION_RATING_CACHE_TYPE}-${key}`,
          cacheType: HISTORICAL_DILUTION_RATING_CACHE_TYPE,
          ticker: key,
          dataJson: payload,
          fetchedAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [askedgarCache.cacheType, askedgarCache.ticker],
          set: { dataJson: payload, fetchedAt: now, expiresAt },
        });
    } catch (error) {
      console.warn('[historical-dilution-rating] Failed to write cache:', error);
    }

    return Response.json(payload);
  } catch (error) {
    logRouteError('historical-dilution-rating', error);
    return internalServerError();
  }
}
