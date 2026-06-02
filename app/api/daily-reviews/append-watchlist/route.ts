import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { dailyReviews, reportTemplates } from '@/lib/db/schema';
import { DAILY_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import type { TemplateField } from '@/lib/validations/reviews';
import { coerceWatchlistRows, WATCHLIST_REPORT_KEY } from '@/lib/watchlist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Same shape used by the research-report route — kept inline so this endpoint
// has no cross-route imports.
const tickerPattern = /^[A-Z0-9.\-^]{1,10}$/;

// The client computes "today" in the user's local timezone (date-fns format
// 'yyyy-MM-dd') and sends it here, matching how DailyReportSheet POSTs to
// /api/daily-reviews. The server doesn't try to guess a timezone.
const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ticker: z.string().trim().toUpperCase().regex(tickerPattern, 'Valid ticker required'),
  reportId: z.string().min(1).max(128).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
});

// Adds one watchlist row onto the user's daily review for the given date. The
// Research page passes reportId; Sheets can pass a bare ticker plus tags.
export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, bodySchema);
    if (bodyState.error) return bodyState.error;
    const { date, ticker, reportId, tags } = bodyState.data;

    const newRow = {
      id: crypto.randomUUID(),
      ticker,
      tags: tags ?? [],
      grade: '',
      notes: '',
      ...(reportId ? { reportId } : {}),
    };

    // 1. Existing daily review for this date? Append (or no-op on duplicate).
    const [existing] = await db
      .select()
      .from(dailyReviews)
      .where(and(eq(dailyReviews.userId, authState.user.id), eq(dailyReviews.date, date)))
      .limit(1);

    if (existing) {
      const reportData = (existing.reportData ?? {}) as Record<string, unknown>;
      const current = coerceWatchlistRows(reportData[WATCHLIST_REPORT_KEY]);
      const alreadyPinned = current.some((row) => {
        if (row.ticker.toUpperCase() !== ticker) return false;
        return reportId ? row.reportId === reportId : true;
      });
      const next = alreadyPinned ? current : [...current, newRow];

      if (!alreadyPinned) {
        const nextReportData = { ...reportData, [WATCHLIST_REPORT_KEY]: next };
        await db
          .update(dailyReviews)
          .set({ reportData: nextReportData, updatedAt: new Date() })
          .where(eq(dailyReviews.id, existing.id));
      }

      return Response.json({ ok: true, reviewId: existing.id, duplicate: alreadyPinned });
    }

    // 2. No row yet — seed one. We need a templateSnapshot since it's NOT NULL.
    // Read the user's daily template, or seed defaults the same way
    // /api/report-templates GET does for a brand-new user.
    let [template] = await db
      .select()
      .from(reportTemplates)
      .where(and(eq(reportTemplates.userId, authState.user.id), eq(reportTemplates.type, 'daily')))
      .limit(1);

    if (!template) {
      const templateId = `${authState.user.id}:template:daily`;
      await db
        .insert(reportTemplates)
        .values({
          id: templateId,
          userId: authState.user.id,
          type: 'daily',
          fields: DAILY_DEFAULT_FIELDS,
          isDefault: true,
        })
        .onConflictDoNothing();
      [template] = await db
        .select()
        .from(reportTemplates)
        .where(and(eq(reportTemplates.userId, authState.user.id), eq(reportTemplates.type, 'daily')))
        .limit(1);
    }

    if (!template) return internalServerError();

    // Drizzle types jsonb columns as `unknown`; the row was written through
    // upsertTemplateSchema so the shape is known. Cast once at the boundary.
    const templateFields = template.fields as TemplateField[];

    const reviewId = `${authState.user.id}:dr:${date}`;
    await db
      .insert(dailyReviews)
      .values({
        id: reviewId,
        userId: authState.user.id,
        date,
        templateId: template.id,
        templateSnapshot: templateFields,
        reportData: { [WATCHLIST_REPORT_KEY]: [newRow] },
        tradeIds: [],
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    return Response.json({ ok: true, reviewId, duplicate: false });
  } catch (error) {
    logRouteError('daily-reviews:append-watchlist', error);
    return internalServerError();
  }
}
