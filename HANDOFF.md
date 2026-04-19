# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-19
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in commit `7118598`; Agent Hardening #2 (trust boundary in prompt assembly) shipped in commit `2a856f1`; Agent Hardening #3 (memory / retention TTL-on-read) shipped in commit `bf13567`; Research agent report refinements shipped in commit `9a69655` on 2026-04-17. See git history and `specs/` for the full implementation records.

## Current State

**Active spec:** Trade Journal Enhancement — DRC + Weekly Review + Archive Tab (below, Status: PLANNED, queued for Codex 2026-04-19).

Next up after this ships: approval gates + spend enforcement from `FUTURE-PLANS.md`.

## Validation Snapshot

Most recent validation (`2026-04-17`, post research agent refinements + follow-up tests):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`48` files, `383` tests)

## Follow-Up Notes

- Production check: after deploy, verify `GET /api/cron/agent-retention` returns `200` when called with the existing project `CRON_SECRET`.
- After first production run of the refined research agents, confirm a Discord embed renders the gap table for a ticker with gap history and the "No historical gap data available." fallback for a ticker without — this was the bug the refactor targeted.

---

## Trade Journal Enhancement — DRC + Weekly Review + Archive Tab

> Generated: 2026-04-19 | Agent: nexus-architect
> Status: PLANNED

### Goal

Add a Daily Report Card (DRC) side-sheet and a Weekly Review side-sheet triggered from a duplicate `TradingCalendar` rendered at the top of `JournalTab`, with a collapsible container persisted to `localStorage`. Three new database tables (`report_templates`, `daily_reviews`, `weekly_reviews`) back the review data. A new top-level Archive tab lets users browse and re-open past reviews.

---

### Phase 1 — Aggregation helpers + calendar callback props

---

**1.1 — CREATE `lib/journal-aggregates.ts`**

File: `/home/jared/Nexus-Terminal/lib/journal-aggregates.ts`
Action: CREATE

1. Create the file with the following exact content:

```ts
import type { Trade } from '@/lib/types';

export interface DayAggregate {
  grossResult: number;
  netResult: number;
  rTotal: number;
  tradeIds: string[];
}

export interface WeekAggregate {
  grossResult: number;
  netResult: number;
  rTotal: number;
  perDayR: { date: string; r: number }[];
  tradeIds: string[];
}

/**
 * Aggregate all trades that fall on `date` (YYYY-MM-DD).
 * R is only counted for trades where initialRisk > 0.
 */
export function aggregateDay(trades: Trade[], date: string): DayAggregate {
  const matching = trades.filter((t) => {
    // trade.date is a Date object after normalizeTrade
    const key = t.date instanceof Date
      ? t.date.toISOString().slice(0, 10)
      : String(t.date).slice(0, 10);
    return key === date;
  });

  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    grossResult += t.grossPnl;
    netResult += t.netPnl;
    if (t.initialRisk && t.initialRisk > 0) {
      rTotal += t.netPnl / t.initialRisk;
    }
    tradeIds.push(t.id);
  }

  return { grossResult, netResult, rTotal, tradeIds };
}

/**
 * Aggregate all trades in [weekStart, weekEnd] inclusive (YYYY-MM-DD strings).
 */
export function aggregateWeek(
  trades: Trade[],
  weekStart: string,
  weekEnd: string,
): WeekAggregate {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(weekEnd + 'T23:59:59');

  const matching = trades.filter((t) => {
    const d = t.date instanceof Date ? t.date : new Date(t.date);
    return d >= start && d <= end;
  });

  // Build per-day R map
  const dayRMap: Record<string, number> = {};
  let grossResult = 0;
  let netResult = 0;
  let rTotal = 0;
  const tradeIds: string[] = [];

  for (const t of matching) {
    const d = t.date instanceof Date ? t.date : new Date(t.date);
    const key = d.toISOString().slice(0, 10);
    grossResult += t.grossPnl;
    netResult += t.netPnl;
    if (t.initialRisk && t.initialRisk > 0) {
      const r = t.netPnl / t.initialRisk;
      rTotal += r;
      dayRMap[key] = (dayRMap[key] ?? 0) + r;
    }
    tradeIds.push(t.id);
  }

  const perDayR = Object.entries(dayRMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => ({ date, r }));

  return { grossResult, netResult, rTotal, perDayR, tradeIds };
}
```

Acceptance:
- [ ] File exists at `/home/jared/Nexus-Terminal/lib/journal-aggregates.ts`
- [ ] `aggregateDay` returns `{ grossResult, netResult, rTotal, tradeIds }` with `rTotal` skipped for trades where `initialRisk` is falsy or zero
- [ ] `aggregateWeek` returns the same fields plus `perDayR` array sorted by date ascending
- [ ] `npx tsc --noEmit` passes

---

**1.2 — MODIFY `components/trading/TradingCalendar.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/TradingCalendar.tsx`
Action: MODIFY

Current state: `TradingCalendarProps` at line 23 has only `trades: Trade[]`. The component manages its own `selectedDate` state and calls `setSelectedDate` inline on day cells (line 137). The weekly summary cell (lines 165–176) has no click handler.

**Step 1 — Extend the props interface (lines 23–25).**

Replace:
```ts
interface TradingCalendarProps {
  trades: Trade[];
}
```

With:
```ts
interface TradingCalendarProps {
  trades: Trade[];
  onDayClick?: (dateKey: string) => void;
  onWeekClick?: (weekStart: string, weekEnd: string) => void;
}
```

**Step 2 — Destructure the new props (line 33).**

Replace:
```ts
export default function TradingCalendar({ trades }: TradingCalendarProps) {
```

With:
```ts
export default function TradingCalendar({ trades, onDayClick, onWeekClick }: TradingCalendarProps) {
```

**Step 3 — Modify the day cell `onClick` (line 137).**

Replace:
```ts
onClick={() => setSelectedDate(isSelected ? null : dateKey)}
```

With:
```ts
onClick={() => {
  if (onDayClick) {
    onDayClick(dateKey);
  } else {
    setSelectedDate(isSelected ? null : dateKey);
  }
}}
```

**Step 4 — Add a click handler to the weekly summary cell (lines 165–176).**

The weekly summary cell currently renders as a plain `<div>`. Wrap its inner content in a conditionally-clickable pattern. Replace:
```ts
{!isMobile ? (
  <div className="min-h-[100px] border-l border-white/5 bg-white/5 p-2">
    <div className="flex h-full flex-col items-center justify-center gap-1">
      <div className={`text-[13px] font-bold ${getPnLColor(week.weeklyPnl)}`}>
        {week.weeklyPnl >= 0 ? '+' : ''}{formatCurrency(week.weeklyPnl)}
      </div>
      <div className={`text-[11px] font-medium opacity-70 ${week.weeklyR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {formatR(week.weeklyR)}
      </div>
    </div>
  </div>
) : null}
```

With:
```ts
{!isMobile ? (
  <div
    className={`min-h-[100px] border-l border-white/5 bg-white/5 p-2 ${onWeekClick ? 'cursor-pointer hover:bg-white/[0.08] transition-colors' : ''}`}
    onClick={() => {
      if (!onWeekClick) return;
      const weekStartDate = week.days[0];
      const weekEndDate = week.days[week.days.length - 1];
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      onWeekClick(fmt(weekStartDate), fmt(weekEndDate));
    }}
  >
    <div className="flex h-full flex-col items-center justify-center gap-1">
      <div className={`text-[13px] font-bold ${getPnLColor(week.weeklyPnl)}`}>
        {week.weeklyPnl >= 0 ? '+' : ''}{formatCurrency(week.weeklyPnl)}
      </div>
      <div className={`text-[11px] font-medium opacity-70 ${week.weeklyR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {formatR(week.weeklyR)}
      </div>
      {onWeekClick && (
        <div className="text-[9px] text-zinc-600 uppercase tracking-widest mt-1">Review</div>
      )}
    </div>
  </div>
) : null}
```

Acceptance:
- [ ] `TradingCalendarProps` has optional `onDayClick` and `onWeekClick` props
- [ ] When `onDayClick` is absent, the day cell still calls `setSelectedDate` (existing behavior is preserved — Dashboard untouched)
- [ ] When `onWeekClick` is absent, the weekly cell is not clickable
- [ ] `npx tsc --noEmit` passes

---

### Phase 2 — Database schema + migration

---

**2.1 — MODIFY `lib/db/schema.ts`**

File: `/home/jared/Nexus-Terminal/lib/db/schema.ts`
Action: MODIFY

**Step 1 — Add missing Drizzle imports.**

Current line 1:
```ts
import { pgTable, text, doublePrecision, integer, serial, timestamp, primaryKey, index, unique, foreignKey, jsonb } from 'drizzle-orm/pg-core';
```

`date` and `boolean` are not imported. Replace line 1 with:
```ts
import { pgTable, text, doublePrecision, integer, serial, timestamp, primaryKey, index, unique, foreignKey, jsonb, date, boolean } from 'drizzle-orm/pg-core';
```

**Step 2 — Append three new table definitions at the end of the file (after line 365).**

Add:

```ts
export const reportTemplates = pgTable('report_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['daily', 'weekly'] }).notNull(),
  fields: jsonb('fields').notNull(),
  isDefault: boolean('is_default').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.userId, t.type),
  index('report_templates_user_type_idx').on(t.userId, t.type),
]);

export const dailyReviews = pgTable('daily_reviews', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  templateId: text('template_id').references(() => reportTemplates.id, { onDelete: 'set null' }),
  templateSnapshot: jsonb('template_snapshot').notNull(),
  reportData: jsonb('report_data').notNull().default({}),
  tradeIds: jsonb('trade_ids').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.userId, t.date),
  index('daily_reviews_user_date_idx').on(t.userId, t.date),
]);

export const weeklyReviews = pgTable('weekly_reviews', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  weekStart: date('week_start').notNull(),
  weekEnd: date('week_end').notNull(),
  templateId: text('template_id').references(() => reportTemplates.id, { onDelete: 'set null' }),
  templateSnapshot: jsonb('template_snapshot').notNull(),
  reportData: jsonb('report_data').notNull().default({}),
  tradeIds: jsonb('trade_ids').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.userId, t.weekStart),
  index('weekly_reviews_user_week_idx').on(t.userId, t.weekStart),
]);
```

**Step 3 — Generate and run the migration.**

Run:
```
npm run db:generate
npm run db:migrate
```

The next migration file will be `drizzle/0020_*.sql`. Do not hand-write it — let `drizzle-kit generate` produce it from the schema diff.

Acceptance:
- [ ] `lib/db/schema.ts` line 1 imports `date` and `boolean`
- [ ] Three new exported table constants exist at the bottom of the file
- [ ] `drizzle/0020_*.sql` exists and contains `CREATE TABLE report_templates`, `CREATE TABLE daily_reviews`, `CREATE TABLE weekly_reviews`
- [ ] `npm run db:migrate` exits 0
- [ ] `npx tsc --noEmit` passes

---

**2.2 — CREATE `lib/validations/reviews.ts`**

File: `/home/jared/Nexus-Terminal/lib/validations/reviews.ts`
Action: CREATE

```ts
import { z } from 'zod';

export const templateFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['bool', 'text', 'number', 'enum', 'auto']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

export type TemplateField = z.infer<typeof templateFieldSchema>;

export const upsertTemplateSchema = z.object({
  type: z.enum(['daily', 'weekly']),
  fields: z.array(templateFieldSchema).min(1),
});

export type UpsertTemplateInput = z.infer<typeof upsertTemplateSchema>;

export const upsertDailyReviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  templateId: z.string().nullable().optional(),
  templateSnapshot: z.array(templateFieldSchema).min(1),
  reportData: z.record(z.string(), z.unknown()),
  tradeIds: z.array(z.string()),
});

export type UpsertDailyReviewInput = z.infer<typeof upsertDailyReviewSchema>;

export const upsertWeeklyReviewSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  templateId: z.string().nullable().optional(),
  templateSnapshot: z.array(templateFieldSchema).min(1),
  reportData: z.record(z.string(), z.unknown()),
  tradeIds: z.array(z.string()),
});

export type UpsertWeeklyReviewInput = z.infer<typeof upsertWeeklyReviewSchema>;
```

Acceptance:
- [ ] File exists and all four schemas compile
- [ ] `npx tsc --noEmit` passes

---

### Phase 3 — API routes

---

**3.1 — CREATE `app/api/report-templates/route.ts`**

File: `/home/jared/Nexus-Terminal/app/api/report-templates/route.ts`
Action: CREATE

```ts
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { reportTemplates } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { upsertTemplateSchema } from '@/lib/validations/reviews';
import type { TemplateField } from '@/lib/validations/reviews';

const DAILY_DEFAULT_FIELDS: TemplateField[] = [
  { id: 'followedProcess',   label: 'Did I follow my process?', type: 'bool',   required: false },
  { id: 'riskedAccordingly', label: 'Did I risk accordingly?',  type: 'bool',   required: false },
  { id: 'missedTrades',      label: 'Missed trades',            type: 'text',   required: false },
  { id: 'thoughts',          label: 'Thoughts',                 type: 'text',   required: false },
  { id: 'goals',             label: 'Goals for tomorrow',       type: 'text',   required: false },
  { id: 'grossResult',       label: 'Gross result',             type: 'auto',   required: false },
  { id: 'netResult',         label: 'Net result',               type: 'auto',   required: false },
  { id: 'rTotal',            label: 'R total',                  type: 'auto',   required: false },
  { id: 'grade',             label: 'Grade',                    type: 'enum',   required: false, options: ['A+','A','B+','B','C+','C','D','F'] },
];

const WEEKLY_DEFAULT_FIELDS: TemplateField[] = [
  { id: 'perDayR',       label: 'R by day',         type: 'auto', required: false },
  { id: 'whatWorked',    label: 'What worked',       type: 'text', required: false },
  { id: 'whatDidnt',     label: "What didn't work",  type: 'text', required: false },
  { id: 'cycleNotes',    label: 'Cycle notes',       type: 'text', required: false },
  { id: 'goalsNextWeek', label: 'Goals next week',   type: 'text', required: false },
];

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

    // Lazy-seed the default template on first access
    const defaultFields = type === 'daily' ? DAILY_DEFAULT_FIELDS : WEEKLY_DEFAULT_FIELDS;
    const id = `${authState.user.id}:template:${type}`;
    await db.insert(reportTemplates).values({
      id,
      userId: authState.user.id,
      type,
      fields: defaultFields,
      isDefault: true,
    }).onConflictDoNothing();

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
    await db.insert(reportTemplates).values({
      id,
      userId: authState.user.id,
      type: body.type,
      fields: body.fields,
      isDefault: false,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [reportTemplates.userId, reportTemplates.type],
      set: { fields: body.fields, isDefault: false, updatedAt: new Date() },
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
```

Acceptance:
- [ ] `GET /api/report-templates?type=daily` returns a template row (seeding on first hit)
- [ ] `GET /api/report-templates?type=weekly` returns a template row
- [ ] `PUT /api/report-templates` with valid body returns the updated template
- [ ] Unauthenticated request returns 401
- [ ] `npx tsc --noEmit` passes

---

**3.2 — CREATE `app/api/daily-reviews/route.ts`**

File: `/home/jared/Nexus-Terminal/app/api/daily-reviews/route.ts`
Action: CREATE

```ts
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { dailyReviews } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { upsertDailyReviewSchema } from '@/lib/validations/reviews';

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const conditions = [eq(dailyReviews.userId, authState.user.id)];
    if (from) conditions.push(gte(dailyReviews.date, from));
    if (to) conditions.push(lte(dailyReviews.date, to));

    const rows = await db
      .select()
      .from(dailyReviews)
      .where(and(...conditions))
      .orderBy(desc(dailyReviews.date));

    return Response.json({ reviews: rows });
  } catch (error) {
    logRouteError('daily-reviews.get', error);
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

    const bodyState = await parseAndValidate(request, upsertDailyReviewSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const id = `${authState.user.id}:dr:${body.date}`;
    await db.insert(dailyReviews).values({
      id,
      userId: authState.user.id,
      date: body.date,
      templateId: body.templateId ?? null,
      templateSnapshot: body.templateSnapshot,
      reportData: body.reportData,
      tradeIds: body.tradeIds,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [dailyReviews.userId, dailyReviews.date],
      set: {
        templateId: body.templateId ?? null,
        templateSnapshot: body.templateSnapshot,
        reportData: body.reportData,
        tradeIds: body.tradeIds,
        updatedAt: new Date(),
      },
    });

    const [saved] = await db
      .select()
      .from(dailyReviews)
      .where(and(eq(dailyReviews.userId, authState.user.id), eq(dailyReviews.date, body.date)))
      .limit(1);

    return Response.json({ review: saved });
  } catch (error) {
    logRouteError('daily-reviews.post', error);
    return internalServerError();
  }
}
```

Acceptance:
- [ ] `GET /api/daily-reviews?from=2026-01-01&to=2026-12-31` returns `{ reviews: [...] }`
- [ ] `POST /api/daily-reviews` with valid body upserts and returns the row
- [ ] Second POST with the same date updates rather than inserts a duplicate
- [ ] Unauthenticated request returns 401

---

**3.3 — CREATE `app/api/daily-reviews/[id]/route.ts`**

File: `/home/jared/Nexus-Terminal/app/api/daily-reviews/[id]/route.ts`
Action: CREATE

```ts
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { dailyReviews } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [row] = await db
      .select()
      .from(dailyReviews)
      .where(and(eq(dailyReviews.id, id), eq(dailyReviews.userId, authState.user.id)))
      .limit(1);

    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ review: row });
  } catch (error) {
    logRouteError('daily-reviews.id.get', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    await db
      .delete(dailyReviews)
      .where(and(eq(dailyReviews.id, id), eq(dailyReviews.userId, authState.user.id)));

    return Response.json({ success: true, id });
  } catch (error) {
    logRouteError('daily-reviews.id.delete', error);
    return internalServerError();
  }
}
```

Acceptance:
- [ ] `GET /api/daily-reviews/[id]` returns 404 for unknown id or wrong user
- [ ] `DELETE /api/daily-reviews/[id]` removes the row and returns `{ success: true }`

---

**3.4 — CREATE `app/api/weekly-reviews/route.ts`**

File: `/home/jared/Nexus-Terminal/app/api/weekly-reviews/route.ts`
Action: CREATE

```ts
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { weeklyReviews } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { upsertWeeklyReviewSchema } from '@/lib/validations/reviews';

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const conditions = [eq(weeklyReviews.userId, authState.user.id)];
    if (from) conditions.push(gte(weeklyReviews.weekStart, from));
    if (to) conditions.push(lte(weeklyReviews.weekStart, to));

    const rows = await db
      .select()
      .from(weeklyReviews)
      .where(and(...conditions))
      .orderBy(desc(weeklyReviews.weekStart));

    return Response.json({ reviews: rows });
  } catch (error) {
    logRouteError('weekly-reviews.get', error);
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

    const bodyState = await parseAndValidate(request, upsertWeeklyReviewSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const id = `${authState.user.id}:wr:${body.weekStart}`;
    await db.insert(weeklyReviews).values({
      id,
      userId: authState.user.id,
      weekStart: body.weekStart,
      weekEnd: body.weekEnd,
      templateId: body.templateId ?? null,
      templateSnapshot: body.templateSnapshot,
      reportData: body.reportData,
      tradeIds: body.tradeIds,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [weeklyReviews.userId, weeklyReviews.weekStart],
      set: {
        weekEnd: body.weekEnd,
        templateId: body.templateId ?? null,
        templateSnapshot: body.templateSnapshot,
        reportData: body.reportData,
        tradeIds: body.tradeIds,
        updatedAt: new Date(),
      },
    });

    const [saved] = await db
      .select()
      .from(weeklyReviews)
      .where(and(eq(weeklyReviews.userId, authState.user.id), eq(weeklyReviews.weekStart, body.weekStart)))
      .limit(1);

    return Response.json({ review: saved });
  } catch (error) {
    logRouteError('weekly-reviews.post', error);
    return internalServerError();
  }
}
```

---

**3.5 — CREATE `app/api/weekly-reviews/[id]/route.ts`**

File: `/home/jared/Nexus-Terminal/app/api/weekly-reviews/[id]/route.ts`
Action: CREATE

Mirror `app/api/daily-reviews/[id]/route.ts` exactly, substituting `weeklyReviews` for `dailyReviews` and `weekly-reviews` in the `logRouteError` tag.

```ts
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { weeklyReviews } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [row] = await db
      .select()
      .from(weeklyReviews)
      .where(and(eq(weeklyReviews.id, id), eq(weeklyReviews.userId, authState.user.id)))
      .limit(1);

    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ review: row });
  } catch (error) {
    logRouteError('weekly-reviews.id.get', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    await db
      .delete(weeklyReviews)
      .where(and(eq(weeklyReviews.id, id), eq(weeklyReviews.userId, authState.user.id)));

    return Response.json({ success: true, id });
  } catch (error) {
    logRouteError('weekly-reviews.id.delete', error);
    return internalServerError();
  }
}
```

Acceptance (3.4 + 3.5):
- [ ] Both route files compile
- [ ] `GET /api/weekly-reviews?from=...&to=...` returns `{ reviews: [...] }`
- [ ] `POST /api/weekly-reviews` upserts on `(userId, weekStart)` conflict
- [ ] `GET` and `DELETE` on `/api/weekly-reviews/[id]` work correctly

---

### Phase 4 — Shared UI components

---

**4.1 — CREATE `components/trading/TemplateFieldRenderer.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/TemplateFieldRenderer.tsx`
Action: CREATE

Note: `switch.tsx` and `checkbox.tsx` do not exist in `components/ui/`. Use a plain HTML `<input type="checkbox">` for `bool` fields.

```tsx
'use client';

import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TemplateField } from '@/lib/validations/reviews';

interface TemplateFieldRendererProps {
  field: TemplateField;
  value: unknown;
  onChange?: (value: unknown) => void;
  readOnly?: boolean;
}

export default function TemplateFieldRenderer({
  field,
  value,
  onChange,
  readOnly = false,
}: TemplateFieldRendererProps) {
  if (field.type === 'auto') {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">{field.label}</p>
        <p className="mt-1 text-sm font-medium text-zinc-200">
          {value != null ? String(value) : '—'}
        </p>
      </div>
    );
  }

  if (field.type === 'bool') {
    const checked = Boolean(value);
    return (
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3 hover:bg-white/[0.07]">
        <input
          type="checkbox"
          checked={checked}
          disabled={readOnly}
          onChange={(e) => onChange?.(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
        <span className="text-sm text-zinc-200">{field.label}</span>
      </label>
    );
  }

  if (field.type === 'text') {
    return (
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">{field.label}</p>
        <Textarea
          value={typeof value === 'string' ? value : ''}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          rows={3}
          className="bg-white/5 border-white/10 text-sm"
          placeholder={readOnly ? '' : `Enter ${field.label.toLowerCase()}…`}
        />
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">{field.label}</p>
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500/50 focus:outline-none"
        />
      </div>
    );
  }

  if (field.type === 'enum' && Array.isArray(field.options)) {
    if (readOnly) {
      return (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">{field.label}</p>
          <p className="mt-1 text-sm font-medium text-zinc-200">{typeof value === 'string' ? value : '—'}</p>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">{field.label}</p>
        <Select value={typeof value === 'string' ? value : ''} onValueChange={(v) => onChange?.(v)}>
          <SelectTrigger className="bg-white/5 border-white/10 text-sm text-zinc-200">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent className="bg-[#18181b] border-white/10 text-white">
            {field.options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return null;
}
```

Acceptance:
- [ ] Component renders without TypeScript errors for all five `type` values
- [ ] `readOnly` disables all inputs and hides placeholders
- [ ] `npx tsc --noEmit` passes

---

**4.2 — CREATE `components/trading/DailyReportSheet.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/DailyReportSheet.tsx`
Action: CREATE

```tsx
'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Pencil, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import JournalTradeChart from '@/components/trading/JournalTradeChart';
import TemplateFieldRenderer from '@/components/trading/TemplateFieldRenderer';
import { aggregateDay } from '@/lib/journal-aggregates';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';
import type { TemplateField } from '@/lib/validations/reviews';

const INITIAL_CHART_BATCH = 4;
const CHART_BATCH_STEP = 4;

interface DailyReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string | null;           // YYYY-MM-DD
  trades: Trade[];
  onSaved?: () => void;
  readOnly?: boolean;
}

interface TemplateRow {
  id: string;
  fields: TemplateField[];
}

interface ReviewRow {
  id: string;
  templateId: string | null;
  templateSnapshot: TemplateField[];
  reportData: Record<string, unknown>;
  tradeIds: string[];
}

export default function DailyReportSheet({
  open,
  onOpenChange,
  date,
  trades,
  onSaved,
  readOnly = false,
}: DailyReportSheetProps) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [existing, setExisting] = useState<ReviewRow | null>(null);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [reportData, setReportData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [chartCount, setChartCount] = useState(INITIAL_CHART_BATCH);

  const isExistingReport = existing !== null;

  useEffect(() => {
    if (!open || !date) return;

    setLoading(true);
    setExisting(null);
    setTemplate(null);
    setFields([]);
    setReportData({});
    setEditingTemplate(false);
    setChartCount(INITIAL_CHART_BATCH);

    void Promise.all([
      fetch(`/api/daily-reviews?from=${date}&to=${date}`).then((r) => r.json()),
      fetch(`/api/report-templates?type=daily`).then((r) => r.json()),
    ]).then(([reviewsRes, templateRes]) => {
      const tmpl = templateRes.template as TemplateRow | undefined;
      const reviews = (reviewsRes.reviews ?? []) as ReviewRow[];
      const found = reviews[0] ?? null;

      setTemplate(tmpl ?? null);

      if (found) {
        setExisting(found);
        setFields(found.templateSnapshot);
        // Merge auto-computed values for display
        const agg = aggregateDay(trades, date);
        const merged: Record<string, unknown> = { ...found.reportData };
        if (merged['grossResult'] == null) merged['grossResult'] = formatCurrency(agg.grossResult);
        if (merged['netResult'] == null) merged['netResult'] = formatCurrency(agg.netResult);
        if (merged['rTotal'] == null) merged['rTotal'] = agg.rTotal.toFixed(2) + 'R';
        setReportData(merged);
      } else if (tmpl) {
        setFields(tmpl.fields);
        const agg = aggregateDay(trades, date);
        const init: Record<string, unknown> = {};
        init['grossResult'] = formatCurrency(agg.grossResult);
        init['netResult'] = formatCurrency(agg.netResult);
        init['rTotal'] = agg.rTotal.toFixed(2) + 'R';
        setReportData(init);
      }
    }).finally(() => setLoading(false));
  }, [open, date, trades]);

  const handleSave = async () => {
    if (!date || !template) return;
    setSaving(true);
    try {
      const agg = aggregateDay(trades, date);
      const res = await fetch('/api/daily-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          templateId: template.id,
          templateSnapshot: fields,
          reportData,
          tradeIds: agg.tradeIds,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Daily review saved');
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error('Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const handleResetTemplate = async () => {
    const res = await fetch('/api/report-templates?type=daily');
    if (!res.ok) return;
    const data = (await res.json()) as { template: TemplateRow };
    // Re-seed defaults by PUTting the hardcoded list — simpler than a ?reset= param
    const defaultRes = await fetch('/api/report-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'daily', fields: data.template.fields }),
    });
    if (!defaultRes.ok) return;
    const updated = (await defaultRes.json()) as { template: TemplateRow };
    setFields(updated.template.fields);
    toast.success('Template reset');
  };

  const saveTemplate = async () => {
    if (!template) return;
    await fetch('/api/report-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'daily', fields }),
    });
    setEditingTemplate(false);
    toast.success('Template saved');
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const copy = [...fields];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= copy.length) return;
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    setFields(copy);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const agg = date ? aggregateDay(trades, date) : null;
  const chartTrades = agg
    ? trades.filter((t) => agg.tradeIds.includes(t.id))
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl bg-[#121214] border-white/10 text-white overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold">
              Daily Review — {date ? format(new Date(date + 'T00:00:00'), 'EEEE, MMM d yyyy') : ''}
            </SheetTitle>
            {!isExistingReport && !readOnly && (
              <button
                onClick={() => setEditingTemplate(!editingTemplate)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                title="Edit template"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="mt-4 space-y-6 p-4">
            {/* Template editor — shown only when pencil is clicked and no existing report */}
            {editingTemplate && !isExistingReport && !readOnly && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Edit Template</p>
                {fields.map((field, i) => (
                  <div key={field.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121214] p-2">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveField(i, -1)} className="rounded p-0.5 hover:bg-white/10"><ChevronUp className="h-3 w-3" /></button>
                      <button onClick={() => moveField(i, 1)} className="rounded p-0.5 hover:bg-white/10"><ChevronDown className="h-3 w-3" /></button>
                    </div>
                    <input
                      value={field.label}
                      onChange={(e) => {
                        const copy = [...fields];
                        copy[i] = { ...copy[i], label: e.target.value };
                        setFields(copy);
                      }}
                      className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                    />
                    <span className="text-[10px] text-zinc-500 w-12 text-center">{field.type}</span>
                    <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => {
                          const copy = [...fields];
                          copy[i] = { ...copy[i], required: e.target.checked };
                          setFields(copy);
                        }}
                        className="accent-emerald-500"
                      />
                      Req
                    </label>
                    <button onClick={() => removeField(i)} className="rounded p-0.5 text-rose-400 hover:bg-rose-500/20">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={saveTemplate} className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs">Save Template</Button>
                  <Button size="sm" variant="outline" onClick={handleResetTemplate} className="text-xs border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10">Reset to Defaults</Button>
                </div>
              </div>
            )}

            {/* Report fields */}
            <div className="space-y-3">
              {fields.map((field) => (
                <TemplateFieldRenderer
                  key={field.id}
                  field={field}
                  value={reportData[field.id]}
                  readOnly={readOnly || isExistingReport}
                  onChange={(v) => setReportData((prev) => ({ ...prev, [field.id]: v }))}
                />
              ))}
            </div>

            {/* Trade replay charts */}
            {chartTrades.length > 0 && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-[#121214] p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Trade Replay Charts</p>
                <div className="space-y-3">
                  {chartTrades.slice(0, chartCount).map((trade) => (
                    <div key={trade.id} className="space-y-1">
                      <p className="text-xs font-semibold text-white">{trade.symbol} ({trade.direction})</p>
                      <JournalTradeChart trade={trade} timeframe="5m" />
                    </div>
                  ))}
                  {chartTrades.length > chartCount && (
                    <div className="flex justify-center">
                      <button
                        onClick={() => setChartCount((n) => Math.min(chartTrades.length, n + CHART_BATCH_STEP))}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10"
                      >
                        Load {Math.min(CHART_BATCH_STEP, chartTrades.length - chartCount)} more charts
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Save button — hidden in readOnly mode and when viewing existing report */}
            {!readOnly && !isExistingReport && (
              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={saving} className="bg-emerald-500 hover:bg-emerald-400 text-black">
                  {saving ? 'Saving…' : 'Save Review'}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

Acceptance:
- [ ] Sheet opens with correct date in the title
- [ ] First open (no existing review): renders empty fields with auto values prefilled; pencil icon visible
- [ ] Second open (existing review): renders saved data; pencil icon hidden; fields are read-only
- [ ] `readOnly` prop forces all fields into read-only mode
- [ ] Save button posts to `/api/daily-reviews` and calls `onSaved?.()` on success
- [ ] `npx tsc --noEmit` passes

---

**4.3 — CREATE `components/trading/WeeklyReviewSheet.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/WeeklyReviewSheet.tsx`
Action: CREATE

```tsx
'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Pencil, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import TemplateFieldRenderer from '@/components/trading/TemplateFieldRenderer';
import { aggregateWeek } from '@/lib/journal-aggregates';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';
import type { TemplateField } from '@/lib/validations/reviews';

interface WeeklyReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekStart: string | null;   // YYYY-MM-DD
  weekEnd: string | null;     // YYYY-MM-DD
  trades: Trade[];
  onSaved?: () => void;
  readOnly?: boolean;
}

interface TemplateRow {
  id: string;
  fields: TemplateField[];
}

interface ReviewRow {
  id: string;
  templateId: string | null;
  templateSnapshot: TemplateField[];
  reportData: Record<string, unknown>;
  tradeIds: string[];
}

export default function WeeklyReviewSheet({
  open,
  onOpenChange,
  weekStart,
  weekEnd,
  trades,
  onSaved,
  readOnly = false,
}: WeeklyReviewSheetProps) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [existing, setExisting] = useState<ReviewRow | null>(null);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [reportData, setReportData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);

  const isExistingReport = existing !== null;

  useEffect(() => {
    if (!open || !weekStart || !weekEnd) return;

    setLoading(true);
    setExisting(null);
    setTemplate(null);
    setFields([]);
    setReportData({});
    setEditingTemplate(false);

    void Promise.all([
      fetch(`/api/weekly-reviews?from=${weekStart}&to=${weekEnd}`).then((r) => r.json()),
      fetch(`/api/report-templates?type=weekly`).then((r) => r.json()),
    ]).then(([reviewsRes, templateRes]) => {
      const tmpl = templateRes.template as TemplateRow | undefined;
      const reviews = (reviewsRes.reviews ?? []) as ReviewRow[];
      const found = reviews[0] ?? null;

      setTemplate(tmpl ?? null);

      const agg = aggregateWeek(trades, weekStart, weekEnd);

      if (found) {
        setExisting(found);
        setFields(found.templateSnapshot);
        const merged: Record<string, unknown> = { ...found.reportData };
        if (merged['perDayR'] == null) merged['perDayR'] = formatPerDayR(agg.perDayR);
        setReportData(merged);
      } else if (tmpl) {
        setFields(tmpl.fields);
        const init: Record<string, unknown> = {};
        init['perDayR'] = formatPerDayR(agg.perDayR);
        setReportData(init);
      }
    }).finally(() => setLoading(false));
  }, [open, weekStart, weekEnd, trades]);

  const handleSave = async () => {
    if (!weekStart || !weekEnd || !template) return;
    setSaving(true);
    try {
      const agg = aggregateWeek(trades, weekStart, weekEnd);
      const res = await fetch('/api/weekly-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStart,
          weekEnd,
          templateId: template.id,
          templateSnapshot: fields,
          reportData,
          tradeIds: agg.tradeIds,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Weekly review saved');
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error('Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = async () => {
    await fetch('/api/report-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'weekly', fields }),
    });
    setEditingTemplate(false);
    toast.success('Template saved');
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const copy = [...fields];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= copy.length) return;
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    setFields(copy);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const agg = weekStart && weekEnd ? aggregateWeek(trades, weekStart, weekEnd) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl bg-[#121214] border-white/10 text-white overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold">
              Weekly Review{weekStart ? ` — ${format(new Date(weekStart + 'T00:00:00'), 'MMM d')} – ${weekEnd ? format(new Date(weekEnd + 'T00:00:00'), 'MMM d, yyyy') : ''}` : ''}
            </SheetTitle>
            {!isExistingReport && !readOnly && (
              <button
                onClick={() => setEditingTemplate(!editingTemplate)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                title="Edit template"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="mt-4 space-y-6 p-4">
            {/* R bar strip — always shown if data exists */}
            {agg && agg.perDayR.length > 0 && (
              <RBarStrip perDayR={agg.perDayR} />
            )}

            {/* Template editor */}
            {editingTemplate && !isExistingReport && !readOnly && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Edit Template</p>
                {fields.map((field, i) => (
                  <div key={field.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121214] p-2">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveField(i, -1)} className="rounded p-0.5 hover:bg-white/10"><ChevronUp className="h-3 w-3" /></button>
                      <button onClick={() => moveField(i, 1)} className="rounded p-0.5 hover:bg-white/10"><ChevronDown className="h-3 w-3" /></button>
                    </div>
                    <input
                      value={field.label}
                      onChange={(e) => {
                        const copy = [...fields];
                        copy[i] = { ...copy[i], label: e.target.value };
                        setFields(copy);
                      }}
                      className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                    />
                    <span className="text-[10px] text-zinc-500 w-12 text-center">{field.type}</span>
                    <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => {
                          const copy = [...fields];
                          copy[i] = { ...copy[i], required: e.target.checked };
                          setFields(copy);
                        }}
                        className="accent-emerald-500"
                      />
                      Req
                    </label>
                    <button onClick={() => removeField(i)} className="rounded p-0.5 text-rose-400 hover:bg-rose-500/20">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <Button size="sm" onClick={saveTemplate} className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs">Save Template</Button>
              </div>
            )}

            {/* Report fields */}
            <div className="space-y-3">
              {fields.map((field) => (
                <TemplateFieldRenderer
                  key={field.id}
                  field={field}
                  value={reportData[field.id]}
                  readOnly={readOnly || isExistingReport}
                  onChange={(v) => setReportData((prev) => ({ ...prev, [field.id]: v }))}
                />
              ))}
            </div>

            {!readOnly && !isExistingReport && (
              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={saving} className="bg-emerald-500 hover:bg-emerald-400 text-black">
                  {saving ? 'Saving…' : 'Save Review'}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Helper: format perDayR for the auto field display value
function formatPerDayR(perDayR: { date: string; r: number }[]): string {
  return perDayR.map(({ date, r }) => `${date}: ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`).join('  |  ');
}

// CSS bar strip component
function RBarStrip({ perDayR }: { perDayR: { date: string; r: number }[] }) {
  const maxAbsR = Math.max(...perDayR.map((d) => Math.abs(d.r)), 0.01);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">R by Day</p>
      <div className="flex items-end gap-2">
        {perDayR.map(({ date, r }) => {
          const heightPx = Math.round((Math.abs(r) / maxAbsR) * 48);
          const label = format(new Date(date + 'T00:00:00'), 'EEE');
          return (
            <div key={date} className="flex flex-col items-center gap-1">
              <div
                style={{ height: `${heightPx}px`, minHeight: '4px' }}
                className={`w-8 rounded-sm ${r >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                title={`${label}: ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`}
              />
              <span className="text-[9px] text-zinc-500">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Acceptance:
- [ ] Sheet title shows week date range
- [ ] R bar strip renders with correct proportional heights and green/red colors
- [ ] Same pencil / read-only / save behavior as `DailyReportSheet`
- [ ] `npx tsc --noEmit` passes

---

### Phase 5 — JournalTab integration

---

**5.1 — MODIFY `components/trading/JournalTab.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/JournalTab.tsx`
Action: MODIFY

**Step 1 — Add new imports at the top of the file (after line 16, before the interface declaration).**

Add after `import type { Trade } from '@/lib/types';` (currently line 15):

```ts
import TradingCalendar from '@/components/trading/TradingCalendar';
import DailyReportSheet from '@/components/trading/DailyReportSheet';
import WeeklyReviewSheet from '@/components/trading/WeeklyReviewSheet';
import { ChevronDown as CalChevronDown, ChevronRight as CalChevronRight } from 'lucide-react';
```

Note: `ChevronDown` and `ChevronRight` are already imported on line 6. Give the new calendar-specific aliases to avoid naming conflicts — OR just reuse the existing import names since they're functionally identical. Simpler: do not add new aliases. Instead, verify the existing `ChevronDown` and `ChevronRight` imports at line 6 are already there. They are. Skip this import and use the existing ones.

Revised Step 1 — Add only the three component imports (after line 15):

```ts
import TradingCalendar from '@/components/trading/TradingCalendar';
import DailyReportSheet from '@/components/trading/DailyReportSheet';
import WeeklyReviewSheet from '@/components/trading/WeeklyReviewSheet';
```

**Step 2 — Add new state inside the component body (after line 71, after the existing `useState` calls).**

Insert after `const [chartTimeframes, setChartTimeframes] = useState<...>({});` (line 71):

```ts
const [calendarOpen, setCalendarOpen] = useState<boolean>(() => {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem('nexus.journal.calendarOpen');
  return stored === null ? true : stored === 'true';
});
const [drcDate, setDrcDate] = useState<string | null>(null);
const [weekRange, setWeekRange] = useState<{ start: string; end: string } | null>(null);

const toggleCalendar = () => {
  const next = !calendarOpen;
  setCalendarOpen(next);
  localStorage.setItem('nexus.journal.calendarOpen', String(next));
};
```

**Step 3 — Add the collapsible calendar block at the top of the JSX return, inside the outer `<motion.div>` and before `<div className="space-y-4">` (currently line 129).**

The current return begins at line 128. Insert the following block between line 128 (the `<motion.div>`) and line 129 (`<div className="space-y-4">`):

```tsx
{/* Calendar block — collapsible, default open, localStorage-persisted */}
<div className="rounded-xl border border-white/10 bg-[#121214] overflow-hidden">
  <button
    onClick={toggleCalendar}
    className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-white/5"
  >
    <span className="text-sm font-semibold text-zinc-300">Trading Calendar</span>
    {calendarOpen
      ? <ChevronDown className="h-4 w-4 text-zinc-500" />
      : <ChevronRight className="h-4 w-4 text-zinc-500" />}
  </button>
  {calendarOpen && (
    <div className="px-4 pb-4">
      <TradingCalendar
        trades={filteredTrades}
        onDayClick={(dateKey) => setDrcDate(dateKey)}
        onWeekClick={(s, e) => setWeekRange({ start: s, end: e })}
      />
    </div>
  )}
</div>
```

**Step 4 — Add the two Sheets at the bottom of the JSX return, just before the closing `</motion.div>` tag (currently line 316).**

Insert before the closing `</motion.div>`:

```tsx
<DailyReportSheet
  open={drcDate !== null}
  onOpenChange={(open) => { if (!open) setDrcDate(null); }}
  date={drcDate}
  trades={filteredTrades}
  onSaved={() => setDrcDate(null)}
/>

<WeeklyReviewSheet
  open={weekRange !== null}
  onOpenChange={(open) => { if (!open) setWeekRange(null); }}
  weekStart={weekRange?.start ?? null}
  weekEnd={weekRange?.end ?? null}
  trades={filteredTrades}
  onSaved={() => setWeekRange(null)}
/>
```

Acceptance:
- [ ] Calendar renders at the top of Journal tab above the day cards
- [ ] Clicking the toggle button collapses/expands the calendar; state survives page reload (localStorage)
- [ ] Clicking a day cell opens `DailyReportSheet` with the correct date
- [ ] Clicking a weekly summary cell opens `WeeklyReviewSheet` with the correct week range
- [ ] `DashboardTab` is untouched — its `TradingCalendar` has no new props and behavior is unchanged
- [ ] `npx tsc --noEmit` passes

---

### Phase 6 — Archive tab

---

**6.1 — CREATE `components/trading/ArchiveTab.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/ArchiveTab.tsx`
Action: CREATE

```tsx
'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import DailyReportSheet from '@/components/trading/DailyReportSheet';
import WeeklyReviewSheet from '@/components/trading/WeeklyReviewSheet';
import { formatCurrency } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';

interface ArchiveTabProps {
  trades: Trade[];
}

type ReviewType = 'daily' | 'weekly';

interface AnyReview {
  id: string;
  type: ReviewType;
  dateLabel: string;      // e.g. "2026-04-14" or "2026-04-14 – 2026-04-18"
  date: string;           // YYYY-MM-DD (weekStart for weekly)
  weekEnd?: string;
  reportData: Record<string, unknown>;
  templateSnapshot: unknown[];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function ninetyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

export default function ArchiveTab({ trades }: ArchiveTabProps) {
  const [reviews, setReviews] = useState<AnyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | ReviewType>('all');
  const [fromDate, setFromDate] = useState(ninetyDaysAgo());
  const [toDate, setToDate] = useState(todayStr());
  const [openReview, setOpenReview] = useState<AnyReview | null>(null);

  const load = () => {
    setLoading(true);
    void Promise.all([
      fetch(`/api/daily-reviews?from=${fromDate}&to=${toDate}`).then((r) => r.json()),
      fetch(`/api/weekly-reviews?from=${fromDate}&to=${toDate}`).then((r) => r.json()),
    ]).then(([dailyRes, weeklyRes]) => {
      const daily: AnyReview[] = ((dailyRes.reviews ?? []) as Array<{ id: string; date: string; reportData: Record<string, unknown>; templateSnapshot: unknown[] }>).map((r) => ({
        id: r.id,
        type: 'daily',
        dateLabel: r.date,
        date: r.date,
        reportData: r.reportData,
        templateSnapshot: r.templateSnapshot,
      }));
      const weekly: AnyReview[] = ((weeklyRes.reviews ?? []) as Array<{ id: string; weekStart: string; weekEnd: string; reportData: Record<string, unknown>; templateSnapshot: unknown[] }>).map((r) => ({
        id: r.id,
        type: 'weekly',
        dateLabel: `${r.weekStart} – ${r.weekEnd}`,
        date: r.weekStart,
        weekEnd: r.weekEnd,
        reportData: r.reportData,
        templateSnapshot: r.templateSnapshot,
      }));
      const merged = [...daily, ...weekly].sort((a, b) => b.date.localeCompare(a.date));
      setReviews(merged);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = reviews.filter((r) => typeFilter === 'all' || r.type === typeFilter);

  const exportRow = (r: AnyReview) => {
    const json = JSON.stringify(r, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.type === 'daily' ? `drc-${r.date}.json` : `weekly-${r.date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div key="archive" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-base text-zinc-400">Past daily and weekly reviews.</p>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | ReviewType)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
        >
          <option value="all">All</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
          />
          <span className="text-zinc-500">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-zinc-500">Loading reviews…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#121214] p-10 text-center text-sm text-zinc-500">
          No reviews in this range.
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-[#121214] overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs text-zinc-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Date / Range</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Grade</th>
                <th className="px-4 py-3">Net Result</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const grade = typeof r.reportData['grade'] === 'string' ? r.reportData['grade'] : null;
                const netRaw = r.reportData['netResult'];
                const net = typeof netRaw === 'string' ? netRaw : typeof netRaw === 'number' ? formatCurrency(netRaw) : '—';
                return (
                  <tr
                    key={r.id}
                    className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] cursor-pointer transition-colors"
                    onClick={() => setOpenReview(r)}
                  >
                    <td className="px-4 py-3 font-mono text-zinc-200">{r.dateLabel}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${r.type === 'daily' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'}`}>
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{grade ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-300">{net}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); exportRow(r); }}
                        className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/10 hover:text-white"
                      >
                        Export
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sheets — opened in readOnly mode from the archive list */}
      {openReview?.type === 'daily' && (
        <DailyReportSheet
          open={true}
          onOpenChange={(open) => { if (!open) setOpenReview(null); }}
          date={openReview.date}
          trades={trades}
          readOnly
        />
      )}
      {openReview?.type === 'weekly' && (
        <WeeklyReviewSheet
          open={true}
          onOpenChange={(open) => { if (!open) setOpenReview(null); }}
          weekStart={openReview.date}
          weekEnd={openReview.weekEnd ?? openReview.date}
          trades={trades}
          readOnly
        />
      )}
    </motion.div>
  );
}
```

Acceptance:
- [ ] Archive tab loads and displays reviews from the last 90 days on mount
- [ ] Type dropdown filters correctly
- [ ] Date inputs refetch on change
- [ ] Clicking a row opens the correct sheet in read-only mode
- [ ] Export button downloads a `.json` file without opening the sheet
- [ ] `npx tsc --noEmit` passes

---

**6.2 — MODIFY `app/page.tsx`**

File: `/home/jared/Nexus-Terminal/app/page.tsx`
Action: MODIFY

**Step 1 — Add the `ArchiveTab` import (after line 17, before `CommandPalette`).**

After `import ResearchTab from '@/components/trading/ResearchTab';` (line 17), add:
```ts
import ArchiveTab from '@/components/trading/ArchiveTab';
```

**Step 2 — Add `'archive'` to `VALID_TABS` (line 24).**

Replace:
```ts
const VALID_TABS: TabKey[] = ['dashboard', 'performance', 'journal', 'filter', 'charts', 'research'];
```

With:
```ts
const VALID_TABS: TabKey[] = ['dashboard', 'performance', 'journal', 'filter', 'charts', 'research', 'archive'];
```

**Step 3 — Add `archive` entry to `TAB_TITLES` (lines 26–33).**

Replace:
```ts
const TAB_TITLES: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  performance: 'Performance Analytics',
  journal: 'Trading Journal',
  filter: 'Trades Management',
  charts: 'Charts',
  research: 'Research',
};
```

With:
```ts
const TAB_TITLES: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  performance: 'Performance Analytics',
  journal: 'Trading Journal',
  filter: 'Trades Management',
  charts: 'Charts',
  research: 'Research',
  archive: 'Archive',
};
```

**Step 4 — Add the render branch for `archive` (after line 300, after the closing `null` of the research block).**

After:
```tsx
{activeTab === 'research' ? (
  <TabErrorBoundary name="Research">
    <ResearchTab />
  </TabErrorBoundary>
) : null}
```

Add:
```tsx
{activeTab === 'archive' ? (
  <TabErrorBoundary name="Archive">
    <ArchiveTab trades={trades} />
  </TabErrorBoundary>
) : null}
```

Acceptance:
- [ ] `VALID_TABS` contains `'archive'`
- [ ] `TAB_TITLES['archive']` is `'Archive'`
- [ ] Navigating to `?tab=archive` renders `ArchiveTab`
- [ ] `npx tsc --noEmit` passes

---

**6.3 — MODIFY `components/trading/Sidebar.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/Sidebar.tsx`
Action: MODIFY

**Step 1 — Add `'archive'` to the `TabKey` union (line 10).**

Replace:
```ts
export type TabKey = 'dashboard' | 'journal' | 'performance' | 'filter' | 'charts' | 'research';
```

With:
```ts
export type TabKey = 'dashboard' | 'journal' | 'performance' | 'filter' | 'charts' | 'research' | 'archive';
```

**Step 2 — Import `Archive` from `lucide-react` (line 3).**

Replace:
```ts
import { Activity, BarChart3, ChartCandlestick, ChevronLeft, ChevronRight, File, Filter, Folder, LayoutGrid, List, Plus, Search, Upload, User } from 'lucide-react';
```

With:
```ts
import { Activity, Archive, BarChart3, ChartCandlestick, ChevronLeft, ChevronRight, File, Filter, Folder, LayoutGrid, List, Plus, Search, Upload, User } from 'lucide-react';
```

**Step 3 — Add Archive to `navItems` (after line 51, after the `research` entry).**

Replace (lines 44–51):
```ts
const navItems: Array<{ tab: TabKey; title: string; icon: typeof LayoutGrid }> = [
  { tab: 'dashboard', title: 'Dashboard', icon: LayoutGrid },
  { tab: 'performance', title: 'Performance', icon: BarChart3 },
  { tab: 'journal', title: 'Journal', icon: List },
  { tab: 'filter', title: 'Trades', icon: Filter },
  { tab: 'charts', title: 'Charts', icon: ChartCandlestick },
  { tab: 'research', title: 'Research', icon: Search },
];
```

With:
```ts
const navItems: Array<{ tab: TabKey; title: string; icon: typeof LayoutGrid }> = [
  { tab: 'dashboard', title: 'Dashboard', icon: LayoutGrid },
  { tab: 'performance', title: 'Performance', icon: BarChart3 },
  { tab: 'journal', title: 'Journal', icon: List },
  { tab: 'filter', title: 'Trades', icon: Filter },
  { tab: 'charts', title: 'Charts', icon: ChartCandlestick },
  { tab: 'research', title: 'Research', icon: Search },
  { tab: 'archive', title: 'Archive', icon: Archive },
];
```

**Step 4 — Add `overflow-x-auto` to the mobile nav container (line 56).**

Replace:
```ts
<div className="flex items-center justify-around text-zinc-500">
```

With:
```ts
{/* TODO: collapse behind More on mobile when nav items exceed screen width */}
<div className="flex items-center justify-around overflow-x-auto text-zinc-500">
```

Acceptance:
- [ ] `TabKey` union includes `'archive'`
- [ ] Archive icon appears in desktop sidebar nav
- [ ] Archive icon appears in mobile bottom nav
- [ ] `npx tsc --noEmit` passes

---

**6.4 — MODIFY `components/trading/CommandPalette.tsx`**

File: `/home/jared/Nexus-Terminal/components/trading/CommandPalette.tsx`
Action: MODIFY

**Step 1 — Add `Archive` to the import (line 4).**

Replace:
```ts
import { BarChart3, ChartCandlestick, Filter, LayoutGrid, List, Plus, Search, Upload } from 'lucide-react';
```

With:
```ts
import { Archive, BarChart3, ChartCandlestick, Filter, LayoutGrid, List, Plus, Search, Upload } from 'lucide-react';
```

**Step 2 — Add the archive entry to `NAV_ITEMS` (after line 28, after the `research` entry).**

Replace `NAV_ITEMS` (lines 16–28):
```ts
const NAV_ITEMS: Array<{
  tab: TabKey;
  label: string;
  icon: typeof LayoutGrid;
  shortcut: string;
}> = [
  { tab: 'dashboard', label: 'Dashboard', icon: LayoutGrid, shortcut: '1' },
  { tab: 'performance', label: 'Performance', icon: BarChart3, shortcut: '2' },
  { tab: 'journal', label: 'Journal', icon: List, shortcut: '3' },
  { tab: 'filter', label: 'Trades', icon: Filter, shortcut: '4' },
  { tab: 'charts', label: 'Charts', icon: ChartCandlestick, shortcut: '5' },
  { tab: 'research', label: 'Research', icon: Search, shortcut: '6' },
];
```

With:
```ts
const NAV_ITEMS: Array<{
  tab: TabKey;
  label: string;
  icon: typeof LayoutGrid;
  shortcut: string;
}> = [
  { tab: 'dashboard', label: 'Dashboard', icon: LayoutGrid, shortcut: '1' },
  { tab: 'performance', label: 'Performance', icon: BarChart3, shortcut: '2' },
  { tab: 'journal', label: 'Journal', icon: List, shortcut: '3' },
  { tab: 'filter', label: 'Trades', icon: Filter, shortcut: '4' },
  { tab: 'charts', label: 'Charts', icon: ChartCandlestick, shortcut: '5' },
  { tab: 'research', label: 'Research', icon: Search, shortcut: '6' },
  { tab: 'archive', label: 'Archive', icon: Archive, shortcut: 'g a' },
];
```

Acceptance:
- [ ] Archive appears in the command palette navigation group with shortcut label `g a`
- [ ] `npx tsc --noEmit` passes

---

**6.5 — MODIFY `hooks/use-global-shortcuts.ts`**

File: `/home/jared/Nexus-Terminal/hooks/use-global-shortcuts.ts`
Action: MODIFY

**Step 1 — Add `'archive'` to `TAB_KEYS` (line 6).**

Replace:
```ts
const TAB_KEYS: TabKey[] = ['dashboard', 'performance', 'journal', 'filter', 'charts', 'research'];
```

With:
```ts
const TAB_KEYS: TabKey[] = ['dashboard', 'performance', 'journal', 'filter', 'charts', 'research', 'archive'];
```

Note: The numeric shortcut loop (`useHotkeys('1' …'6'…`) maps by index. `'archive'` is at index 6. Do NOT add a `'7'` numeric shortcut — the plan specifies no numeric shortcut for Archive.

**Step 2 — Add the `g a` sequence shortcut (after line 19, after the `useHotkeys('6', ...)` call).**

The repo uses simple string keys like `'1'`…`'6'`. Verify how multi-key sequences are handled: the file currently has no sequence shortcuts. `react-hotkeys-hook` v5 uses `>` as a sequence separator. Add:

```ts
useHotkeys('g>a', () => setActiveTab('archive'), { preventDefault: true });
```

Insert this line after `useHotkeys('6', () => setActiveTab(TAB_KEYS[5]));` and before the `useHotkeys('meta+k, ctrl+k', ...)` block.

Acceptance:
- [ ] `TAB_KEYS` array has 7 entries with `'archive'` last
- [ ] The numeric shortcuts `1`–`6` still map to the original six tabs (unchanged — archive has no numeric shortcut)
- [ ] Pressing `g` then `a` in sequence navigates to the archive tab
- [ ] `npx tsc --noEmit` passes

---

### Files Changed Summary

| File | Action | Risk | Notes |
|------|--------|------|-------|
| `lib/journal-aggregates.ts` | CREATE | LOW | Pure helpers, no side effects |
| `components/trading/TradingCalendar.tsx` | MODIFY | LOW | Props are additive; existing behavior preserved when props absent |
| `lib/db/schema.ts` | MODIFY | MEDIUM | Schema change; requires migration |
| `drizzle/0020_*.sql` | CREATE (generated) | MEDIUM | Run `db:generate` then `db:migrate` |
| `lib/validations/reviews.ts` | CREATE | LOW | Zod schemas only |
| `app/api/report-templates/route.ts` | CREATE | LOW | New auth-gated route |
| `app/api/daily-reviews/route.ts` | CREATE | LOW | New auth-gated route |
| `app/api/daily-reviews/[id]/route.ts` | CREATE | LOW | New auth-gated route |
| `app/api/weekly-reviews/route.ts` | CREATE | LOW | New auth-gated route |
| `app/api/weekly-reviews/[id]/route.ts` | CREATE | LOW | New auth-gated route |
| `components/trading/TemplateFieldRenderer.tsx` | CREATE | LOW | Dumb display component |
| `components/trading/DailyReportSheet.tsx` | CREATE | MEDIUM | Fetch + state + save logic |
| `components/trading/WeeklyReviewSheet.tsx` | CREATE | MEDIUM | Fetch + state + save logic |
| `components/trading/JournalTab.tsx` | MODIFY | MEDIUM | New state, new imports, new JSX block |
| `components/trading/ArchiveTab.tsx` | CREATE | MEDIUM | New tab with fetch + filtering |
| `app/page.tsx` | MODIFY | LOW | Additive: one import, one array entry, one title entry, one JSX branch |
| `components/trading/Sidebar.tsx` | MODIFY | LOW | Additive: one union value, one navItem, one icon import |
| `components/trading/CommandPalette.tsx` | MODIFY | LOW | Additive: one NAV_ITEMS entry |
| `hooks/use-global-shortcuts.ts` | MODIFY | LOW | Additive: one array entry, one hotkey |

---

### Verification Steps

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run db:generate` — confirm `drizzle/0020_*.sql` was created and contains the three new tables
5. `npm run db:migrate` — confirm migration exits 0

**Manual smoke test:**
1. Open Journal tab — confirm calendar renders above day cards; toggle button collapses and reopens it; state persists after page reload.
2. Click a day cell that has trades — confirm `DailyReportSheet` opens with the correct date in the title and auto fields populated.
3. Fill in a text field, click Save — confirm toast appears and sheet closes.
4. Click the same day cell again — confirm the sheet opens in read-only mode showing saved data; pencil icon is hidden.
5. Click a weekly summary cell — confirm `WeeklyReviewSheet` opens with the correct week range and the R bar strip renders.
6. Navigate to Archive tab (sidebar or command palette `g`→`a`) — confirm reviews appear in the list.
7. Click a list row — confirm the correct sheet opens in read-only mode.
8. Click Export on a row — confirm a `.json` file downloads without opening the sheet.
9. Navigate to Dashboard — confirm `TradingCalendar` there has no new click behaviors and the inline expand still works.

---

### Open Questions for Codex

None — the plan is locked.
