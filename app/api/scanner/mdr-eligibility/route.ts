import { z } from 'zod';

import { internalServerError, logRouteError, TICKER_REGEX } from '@/lib/api-route-utils';
import { computeMdrEligibility } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .transform((v) => v.trim().toUpperCase())
    .refine((value) => TICKER_REGEX.test(value), 'Invalid ticker format'),
  mark: z.coerce.number().positive().finite(),
});

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    ticker: searchParams.get('ticker') ?? '',
    mark: searchParams.get('mark') ?? '',
  });
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const { ticker, mark } = parsed.data;

  try {
    const result = await computeMdrEligibility(ticker, mark);
    return Response.json(result);
  } catch (error) {
    logRouteError('scanner-mdr-eligibility', error);
    return internalServerError();
  }
}
