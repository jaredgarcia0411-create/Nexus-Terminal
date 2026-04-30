import { z } from 'zod';

import { internalServerError, logRouteError, TICKER_REGEX } from '@/lib/api-route-utils';
import { getCachedScannerSummary } from '@/lib/askedgar';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => TICKER_REGEX.test(value), 'Invalid ticker format'),
});

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const { searchParams } = new URL(request.url);
  const rawTicker = searchParams.get('ticker') ?? '';

  const parsed = querySchema.safeParse({ ticker: rawTicker });
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const { ticker } = parsed.data;

  try {
    const summary = await getCachedScannerSummary(ticker);
    return Response.json(summary);
  } catch (error) {
    logRouteError('askedgar-scanner-summary', error);
    return internalServerError();
  }
}
