import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDb, getPoolDb } from '@/lib/db';
import { userCredentials, users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/password';

const USER_ID_PATTERN = /^[a-z0-9._-]{3,32}$/;

const payloadSchema = z.object({
  userId: z.string().trim().toLowerCase().regex(USER_ID_PATTERN, 'User ID must be 3-32 chars: lowercase letters, numbers, ., _, -'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: Request) {
  const json = (await request.json().catch(() => ({}))) as unknown;
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
  }

  const { userId: loginId, password } = parsed.data;
  const userId = randomUUID();
  const email = `${loginId}@local.nexus`;
  const passwordHash = await hashPassword(password);

  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database not configured' }, { status: 503 });
  }

  const existing = await db.select({ loginId: userCredentials.loginId })
    .from(userCredentials)
    .where(eq(userCredentials.loginId, loginId))
    .limit(1);
  if (existing.length > 0) {
    return Response.json({ error: 'User ID is already taken' }, { status: 409 });
  }

  const poolDb = getPoolDb();
  if (poolDb) {
    await poolDb.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        name: loginId,
        picture: null,
      });
      await tx.insert(userCredentials).values({ loginId, userId, passwordHash });
    });
  } else {
    await db.insert(users).values({
      id: userId,
      email,
      name: loginId,
      picture: null,
    });
    await db.insert(userCredentials).values({ loginId, userId, passwordHash });
  }

  return Response.json({ ok: true, userId: loginId }, { status: 201 });
}
