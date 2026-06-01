import { and, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb, type Db } from '@/lib/db';
import { sheetMembers, sheets } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { memberRoleSchema } from '@/lib/validations/sheets';

type OwnerGate =
  | { db: Db; ownerUserId: string | null; error?: never }
  | { db?: never; ownerUserId?: never; error: Response };

async function loadOwnerGate(sheetId: string, userId: string): Promise<OwnerGate> {
  const db = getDb();
  if (!db) return { error: dbUnavailable() };

  const role = await getSheetRole(db, sheetId, userId);
  if (!role) return { error: Response.json({ error: 'Sheet not found' }, { status: 404 }) };
  if (role !== 'owner') return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) };

  const [sheet] = await db
    .select({ ownerUserId: sheets.ownerUserId })
    .from(sheets)
    .where(eq(sheets.id, sheetId))
    .limit(1);
  return { db, ownerUserId: sheet?.ownerUserId ?? null };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, memberRoleSchema);
    if (bodyState.error) return bodyState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id, userId } = await context.params;
    const gate = await loadOwnerGate(id, authState.user.id);
    if (gate.error) return gate.error;
    if (userId === gate.ownerUserId) {
      return Response.json({ error: "The owner's role cannot be changed." }, { status: 400 });
    }

    const [updated] = await db
      .update(sheetMembers)
      .set({ role: bodyState.data.role })
      .where(and(eq(sheetMembers.sheetId, id), eq(sheetMembers.userId, userId)))
      .returning();
    if (!updated) return Response.json({ error: 'Member not found' }, { status: 404 });

    return Response.json({ member: { userId, role: bodyState.data.role } });
  } catch (error) {
    logRouteError('sheets.members.patch', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id, userId } = await context.params;
    const gate = await loadOwnerGate(id, authState.user.id);
    if (gate.error) return gate.error;
    if (userId === gate.ownerUserId) {
      return Response.json({ error: 'The owner cannot be removed.' }, { status: 400 });
    }

    await db
      .delete(sheetMembers)
      .where(and(eq(sheetMembers.sheetId, id), eq(sheetMembers.userId, userId)));

    return Response.json({ removed: true, userId });
  } catch (error) {
    logRouteError('sheets.members.delete', error);
    return internalServerError();
  }
}
