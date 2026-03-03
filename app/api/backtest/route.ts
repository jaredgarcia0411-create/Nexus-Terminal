import { requireUser } from '@/lib/server-db-utils';

const GATEWAY_URL = process.env.BACKTEST_GATEWAY_URL || 'http://localhost:4000';

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/api/backtest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': authState.user.id,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (error) {
    return Response.json(
      { error: 'Backtest gateway unavailable. Start the gateway with: cd services && docker compose up' },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) {
    return Response.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/api/backtest/${encodeURIComponent(jobId)}`, {
      headers: { 'x-user-id': authState.user.id },
    });

    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (error) {
    return Response.json(
      { error: 'Backtest gateway unavailable' },
      { status: 503 },
    );
  }
}
