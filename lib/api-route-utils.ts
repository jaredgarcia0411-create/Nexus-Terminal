type JsonParseResult<T> =
  | { data: T; error?: never }
  | { data?: never; error: Response };

export async function parseJsonBody<T>(request: Request): Promise<JsonParseResult<T>> {
  try {
    const data = (await request.json()) as T;
    return { data };
  } catch {
    return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
}

export function logRouteError(route: string, error: unknown) {
  console.error(`[api:${route}] unhandled error`, error);
}

export function internalServerError() {
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}
