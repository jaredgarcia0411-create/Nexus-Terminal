import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { reportTemplates } from '@/lib/db/schema';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { DAILY_DEFAULT_FIELDS, WEEKLY_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { upsertTemplateSchema } from '@/lib/validations/reviews';

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    if (type !== 'daily' && type !== 'weekly') {
      return Response.json({ error: 'type must be daily or weekly' }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(reportTemplates)
      .where(and(eq(reportTemplates.userId, authState.user.id), eq(reportTemplates.type, type)))
      .limit(1);

    if (existing) {
      return Response.json({ template: existing });
    }

    const defaultFields = type === 'daily' ? DAILY_DEFAULT_FIELDS : WEEKLY_DEFAULT_FIELDS;
    const id = `${authState.user.id}:template:${type}`;

    await db
      .insert(reportTemplates)
      .values({
        id,
        userId: authState.user.id,
        type,
        fields: defaultFields,
        isDefault: true,
      })
      .onConflictDoNothing();

    const [seeded] = await db
      .select()
      .from(reportTemplates)
      .where(and(eq(reportTemplates.userId, authState.user.id), eq(reportTemplates.type, type)))
      .limit(1);

    return Response.json({ template: seeded });
  } catch (error) {
    logRouteError('report-templates.get', error);
    return internalServerError();
  }
}

export async function PUT(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, upsertTemplateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const id = `${authState.user.id}:template:${body.type}`;
    await db
      .insert(reportTemplates)
      .values({
        id,
        userId: authState.user.id,
        type: body.type,
        fields: body.fields,
        isDefault: false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [reportTemplates.userId, reportTemplates.type],
        set: {
          fields: body.fields,
          isDefault: false,
          updatedAt: new Date(),
        },
      });

    const [updated] = await db
      .select()
      .from(reportTemplates)
      .where(and(eq(reportTemplates.userId, authState.user.id), eq(reportTemplates.type, body.type)))
      .limit(1);

    return Response.json({ template: updated });
  } catch (error) {
    logRouteError('report-templates.put', error);
    return internalServerError();
  }
}
