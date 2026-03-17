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

export function logRouteError(route: string, error: unknown) {
  console.error(`[api:${route}] unhandled error`, error);
}

export function internalServerError() {
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}
