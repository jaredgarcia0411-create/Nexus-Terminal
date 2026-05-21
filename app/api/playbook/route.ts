import { randomUUID } from 'crypto';
import { and, asc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { playbookStrategies } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { createStrategySchema, updateStrategySchema, type PlaybookSections } from '@/lib/validations/playbook';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const rows = await db
      .select()
      .from(playbookStrategies)
      .where(eq(playbookStrategies.userId, authState.user.id))
      .orderBy(asc(playbookStrategies.createdAt));

    return Response.json({ strategies: rows });
  } catch (error) {
    logRouteError('playbook.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, createStrategySchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const id = randomUUID();
    const [row] = await db
      .insert(playbookStrategies)
      .values({
        id,
        userId: authState.user.id,
        name: body.name,
        description: body.description,
        tag: body.tag,
        sections: body.sections,
      })
      .returning();

    return Response.json({ strategy: row });
  } catch (error) {
    logRouteError('playbook.post', error);
    return internalServerError();
  }
}

export async function PATCH(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return Response.json({ error: 'id query param is required' }, { status: 400 });
    }

    const bodyState = await parseAndValidate(request, updateStrategySchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const updates: {
      name?: string;
      description?: string;
      tag?: string;
      sections?: PlaybookSections;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.tag !== undefined) updates.tag = body.tag;
    if (body.sections !== undefined) updates.sections = body.sections;

    const [row] = await db
      .update(playbookStrategies)
      .set(updates)
      .where(and(
        eq(playbookStrategies.id, id),
        eq(playbookStrategies.userId, authState.user.id),
      ))
      .returning();

    if (!row) {
      return Response.json({ error: 'strategy not found' }, { status: 404 });
    }

    return Response.json({ strategy: row });
  } catch (error) {
    logRouteError('playbook.patch', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return Response.json({ error: 'id query param is required' }, { status: 400 });
    }

    const result = await db
      .delete(playbookStrategies)
      .where(and(
        eq(playbookStrategies.id, id),
        eq(playbookStrategies.userId, authState.user.id),
      ))
      .returning({ id: playbookStrategies.id });

    if (result.length === 0) {
      return Response.json({ error: 'strategy not found' }, { status: 404 });
    }

    return Response.json({ success: true, id: result[0].id });
  } catch (error) {
    logRouteError('playbook.delete', error);
    return internalServerError();
  }
}
