export function isAuthorizedCronRequest(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return { ok: false as const, response: Response.json({ error: 'Cron secret is not configured' }, { status: 503 }) };
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';

  if (!token || token !== expected) {
    return { ok: false as const, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { ok: true as const };
}
