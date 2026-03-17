import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { scannerPresets } from '@/lib/db/schema';
import { ensureUser, requireUser } from '@/lib/server-db-utils';
import { presetBodySchema } from '@/lib/validations/system';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) {
      return authState.error;
    }

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    await ensureUser(db, authState.user);

    const rows = await db
      .select({
        id: scannerPresets.id,
        name: scannerPresets.name,
        filtersJson: scannerPresets.filtersJson,
        createdAt: scannerPresets.createdAt,
        updatedAt: scannerPresets.updatedAt,
      })
      .from(scannerPresets)
      .where(eq(scannerPresets.userId, authState.user.id))
      .orderBy(desc(scannerPresets.updatedAt));

    return Response.json({ presets: rows });
  } catch (error) {
    logRouteError('scanner-presets.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) {
      return authState.error;
    }

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const bodyState = await parseAndValidate(request, presetBodySchema);
    if (bodyState.error) {
      return bodyState.error;
    }

    await ensureUser(db, authState.user);

    const { name } = bodyState.data;

    const filters = bodyState.data.filters ?? {};
    const now = new Date();

    await db
      .insert(scannerPresets)
      .values({
        id: crypto.randomUUID(),
        userId: authState.user.id,
        name,
        filtersJson: filters,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [scannerPresets.userId, scannerPresets.name],
        set: {
          filtersJson: filters,
          updatedAt: now,
        },
      });

    return Response.json({ name, filters });
  } catch (error) {
    logRouteError('scanner-presets.post', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) {
      return authState.error;
    }

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    await ensureUser(db, authState.user);

    const { searchParams } = new URL(request.url);
    const id = (searchParams.get('id') ?? '').trim();
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    await db
      .delete(scannerPresets)
      .where(and(eq(scannerPresets.userId, authState.user.id), eq(scannerPresets.id, id)));

    return Response.json({ success: true });
  } catch (error) {
    logRouteError('scanner-presets.delete', error);
    return internalServerError();
  }
}
