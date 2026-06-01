import { eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetMembers, sheets, users } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { memberAddSchema } from '@/lib/validations/sheets';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, memberAddSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role !== 'owner') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const [target] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (!target) {
      return Response.json(
        { error: 'No Nexus account uses that email yet. Ask them to sign in once, then try again.' },
        { status: 404 },
      );
    }

    const [sheet] = await db
      .select({ ownerUserId: sheets.ownerUserId })
      .from(sheets)
      .where(eq(sheets.id, id))
      .limit(1);
    if (sheet && target.id === sheet.ownerUserId) {
      return Response.json({ error: 'That user is the owner of this sheet.' }, { status: 400 });
    }

    await db
      .insert(sheetMembers)
      .values({ sheetId: id, userId: target.id, role: body.role })
      .onConflictDoUpdate({
        target: [sheetMembers.sheetId, sheetMembers.userId],
        set: { role: body.role },
      });

    return Response.json(
      { member: { userId: target.id, role: body.role, name: target.name, email: target.email } },
      { status: 201 },
    );
  } catch (error) {
    logRouteError('sheets.members.post', error);
    return internalServerError();
  }
}
