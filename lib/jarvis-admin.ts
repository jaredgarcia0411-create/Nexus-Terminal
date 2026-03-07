const ADMIN_HEADER_NAME = 'x-jarvis-admin-key';

export function requireJarvisAdmin(request: Request) {
  const configuredKey = process.env.JARVIS_ADMIN_KEY?.trim();
  if (!configuredKey) {
    return Response.json({ error: 'Jarvis admin key is not configured.' }, { status: 503 });
  }

  const providedKey = request.headers.get(ADMIN_HEADER_NAME)?.trim();
  if (!providedKey || providedKey !== configuredKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
