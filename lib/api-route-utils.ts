import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

type ValidateResult<T> =
  | { data: T; error?: never }
  | { data?: never; error: Response };

export async function parseAndValidate<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ValidateResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      error: Response.json(
        { error: 'Validation failed', details: z.flattenError(result.error) },
        { status: 400 },
      ),
    };
  }

  return { data: result.data };
}

// Constant-time comparison for shared secrets (cron, service and admin keys).
// A plain `===` short-circuits on the first differing byte, which leaks how
// much of a guess was right. Hashing both sides first gives equal-length
// buffers so timingSafeEqual can be used regardless of input length.
export function secretsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function logRouteError(route: string, error: unknown) {
  console.error(`[api:${route}] unhandled error`, error);
}

export function internalServerError() {
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}

export const TICKER_REGEX = /^[A-Z0-9.\-^]{1,10}$/;

export function normalizeTicker(input: string | undefined): string {
  return (input ?? '').trim().toUpperCase();
}

export function toNumberOrUndefined(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
