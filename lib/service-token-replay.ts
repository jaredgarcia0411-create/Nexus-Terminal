import { lt } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { serviceTokenJtis } from '@/lib/db/schema';

export async function consumeServiceTokenJti(db: Db, jti: string, exp: number) {
  const expiresAt = new Date(exp * 1000);
  const now = new Date();

  // Best-effort cleanup keeps this table bounded without a dedicated janitor.
  await db.delete(serviceTokenJtis).where(lt(serviceTokenJtis.expiresAt, now));

  const inserted = await db.insert(serviceTokenJtis)
    .values({ jti, expiresAt })
    .onConflictDoNothing()
    .returning({ jti: serviceTokenJtis.jti });

  return inserted.length > 0;
}
