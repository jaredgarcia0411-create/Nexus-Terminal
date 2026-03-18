# Stripe Payment Processor Agent Minions Crash Course
**Researched**: 2026-03-17
**Sources**: Web docs, official docs, codebase analysis
**Context**: Codebase-specific research

---

## Concept Overview
"Stripe Payment Processor Agent Minions" is a practical architecture where small background workers ("minions") process payment events safely and independently. The key idea is that Stripe webhooks are the source of truth for payment outcomes, while your API routes stay thin and fast. In this codebase, Stripe is not implemented yet, so the focus is how to add it using existing Nexus patterns.

## How It Works
1. Your app starts checkout from a protected API route (server-side).
2. Stripe returns a Checkout Session (or PaymentIntent for advanced custom flows).
3. Stripe sends webhook events (`checkout.session.completed`, `invoice.paid`, etc.).
4. Your webhook route verifies the Stripe signature from the raw request body.
5. The webhook inserts `event.id` into a dedupe table and quickly returns `200`.
6. A worker/minion consumes queued events and performs idempotent fulfillment (entitlements, credits, feature access).
7. If processing fails, retries are safe because dedupe + idempotent writes prevent double side effects.

## Code Examples

### Basic Usage
```ts
// app/api/stripe/webhook/route.ts (example skeleton)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
  maxNetworkRetries: 2,
});

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  // 1) persist event.id with unique constraint
  // 2) enqueue background minion job
  // 3) return quickly
  return Response.json({ received: true });
}
```

### In Your Codebase
From: `lib/server-db-utils.ts`
```ts
export async function requireUser() {
  const session = await auth();
  const user = session?.user as ({ id?: string; email?: string | null; name?: string | null; image?: string | null } | undefined);
  if (!user?.id || !user.email) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      picture: user.image ?? null,
    },
  };
}
```

From: `app/api/trades/import/route.ts`
```ts
const inserted = await tx.insert(tradeImportBatches)
  .values({ userId: authState.user.id, batchKey })
  .onConflictDoNothing()
  .returning({ batchKey: tradeImportBatches.batchKey });
```

Why this matters for Stripe: this repo already uses idempotent conflict handling (`onConflictDoNothing` / `onConflictDoUpdate`) and protected server routes (`requireUser`). Reuse these patterns for webhook dedupe and fulfillment safety.

## Best Practices
1. Use webhook-first fulfillment; never trust the client success page alone.
2. Verify webhook signatures from raw body before any parsing.
3. Return `2xx` fast and move heavy processing to minion workers.
4. Enforce idempotency in the database with unique constraints on Stripe `event.id`.
5. Use idempotency keys for Stripe POST requests and retry with same key + same params.

## Common Pitfalls
**Pitfall**: Doing fulfillment directly in checkout success page.
**Solution**: Treat it as UX only; do real fulfillment in webhook worker.

**Pitfall**: Parsing JSON first, then verifying signature.
**Solution**: Verify with raw bytes (`request.arrayBuffer()`) first.

**Pitfall**: No dedupe table for Stripe events.
**Solution**: Create `stripe_events` with unique `event_id` and skip duplicates safely.

## Codebase-Specific Findings
- There is currently no live Stripe runtime integration in this codebase (no Stripe SDK in `package.json`, no Stripe webhook route).
- `PRD.md` marks billing as a non-goal right now (`no billing`), so Stripe work is future-facing.
- Existing API conventions you should follow when Stripe is added:
  - Auth and user resolution: `lib/server-db-utils.ts`
  - Request validation + error shape: `lib/api-route-utils.ts`
  - DB transaction/idempotency patterns: `app/api/trades/import/route.ts`

## Related Topics
- Stripe Checkout vs Payment Element decision framework
- Subscription lifecycle modeling (`trialing`, `active`, `past_due`, `canceled`)
- Queue architecture in serverless environments (Upstash QStash, BullMQ worker service, Temporal)
- Replay and reconciliation for missed webhook deliveries

## Follow-up Questions

---
*To continue learning, use: `/research more about Stripe webhook deduplication and replay` or ask follow-up questions*
