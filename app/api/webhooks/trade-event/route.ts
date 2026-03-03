import { NextRequest } from 'next/server';

const VALID_EVENTS = ['trade_imported', 'sync_complete'] as const;
type TradeEvent = (typeof VALID_EVENTS)[number];

export async function POST(request: NextRequest) {
  const secret = process.env.TRADE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { event?: string; userId?: string; data?: unknown };

  if (!body.event || !VALID_EVENTS.includes(body.event as TradeEvent)) {
    return Response.json({ error: `Invalid event. Must be one of: ${VALID_EVENTS.join(', ')}` }, { status: 400 });
  }

  if (!body.userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  // TODO: Deliver webhook payload to Discord bot
  return Response.json({ received: true, event: body.event });
}
