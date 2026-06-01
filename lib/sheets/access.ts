import { and, eq } from 'drizzle-orm';

import { sheetMembers } from '@/lib/db/schema';
import type { QueryDb } from '@/lib/server-db-utils';

export type SheetRole = 'owner' | 'editor' | 'viewer';

export async function getSheetRole(
  db: QueryDb,
  sheetId: string,
  userId: string,
): Promise<SheetRole | null> {
  const [row] = await db
    .select({ role: sheetMembers.role })
    .from(sheetMembers)
    .where(and(eq(sheetMembers.sheetId, sheetId), eq(sheetMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}
