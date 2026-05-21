# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-21
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

---

## Open Follow-Ups (carried forward, not yet verified)

- **Offerings extractors — fresh-ticker smoke check**: the 2026-05-19 broadening (Changes 1–5 of the previous spec) shipped but the WNW manual smoke was inconclusive because the snapshot was cached. Next time you open Research on a fresh ADS / FPI ticker (any ticker whose `askedgar_cache` row has expired or doesn't yet exist), confirm Shares / Price / Amount columns populate for at least one priced row in the Past Offerings table. If everything is "--", capture the filing URL from the row's SEC link and open a follow-up spec for whichever phrasing variant the current regexes don't cover.

---

## Spec: Playbook page in Management tab

> Generated: 2026-05-21 | Author: inline (post-Q&A; design decisions confirmed by user)
> Status: COMPLETED 2026-05-21
> Owner: Codex

Completion evidence:
- Implemented Changes 1-7 in order: schema/table export, generated/applied migration, validation/default helpers, `/api/playbook`, `PlaybookTab`, and Management sub-nav wiring.
- Generated migration: `drizzle/0041_volatile_sharon_ventura.sql` plus `drizzle/meta/0041_snapshot.json`; SQL is additive for `playbook_strategies` with user FK cascade and user/created index.
- Validation passed: `npm run db:migrate`, `npm run lint`, `npx tsc --noEmit`, `npm test`.
- Local sandbox `npm run dev` was blocked by `listen EPERM` on port 3000; user ran `npm run dev` manually and reported the UI looks good.

### Goal

Add a "Playbook" sub-tab to the Management page where the user can document each trading strategy they run (Overview / Pre-trade checklist / Entry / Invalidation / Risk / Targets / Notes), tag each strategy with a string that matches their existing trade tags, and see a Recent Trades panel auto-computed from trades carrying that tag (last 10 trades, win%, avg R, total P/L).

### Confirmed design decisions

- **Position in sub-nav**: between `performance` and `career-pnl`.
- **Layout**: two columns. Left = strategies list. Right = selected-strategy detail with an explicit **Save** button (no autosave).
- **Section order in the strategy detail**: Overview → Pre-trade checklist → Entry Criteria → Invalidation → Risk / Stop → Profit Targets → Notes → Recent Trades.
- **Pre-trade checklist**: static reference list (user types one bullet per line; display renders as a `<ul>`). Not interactive — no per-trade state.
- **Tag input**: free-text. Whatever the user types must match a trade tag exactly to drive the Recent Trades panel.
- **Strategy list ordering**: `createdAt` ascending. No drag-reorder in v1.
- **Delete**: button in the right-panel header next to Save. Confirm via `window.confirm()` like CareerPnlTab.
- **Recent Trades stats**: last 10 trades in the table; stats computed across **all** trades matching the strategy's tag (win%, avg R, total P/L).
- **Storage**: one row per strategy; the 7 free-form sections live in a single `sections` JSONB column (mirrors how `report_templates.fields` is stored, so adding a future section is a code change, not a schema migration).

### Background context Codex must know first

- Sub-tab pattern: `components/trading/ManagementTab.tsx` holds a `SUB_TABS` array and a single `activeSubTab` state; each tab is rendered conditionally. Adding "Playbook" follows the existing pattern exactly — no new abstractions.
- Tab component pattern: see `components/trading/CareerPnlTab.tsx` as the closest model — self-contained client component, fetches its own data on mount via a typed `useState` + `useEffect`, uses `toast` from sonner for error feedback, green pill buttons use the class string `border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20`.
- API pattern: see `app/api/career-pnl/route.ts` as the closest model — single `route.ts` exporting GET / POST / PATCH / DELETE, every handler starts with `requireUser()` + `ensureUser()`, body parsing via `parseAndValidate(request, schema)` from `lib/api-route-utils.ts`, errors via `logRouteError('<route>.<verb>', error)` + `internalServerError()`.
- Trade tag shape: `Trade.tags: string[]` (see `lib/types.ts:40`). The Recent Trades panel filters with `trade.tags.includes(strategy.tag)` and computes stats client-side from `filteredTrades` already passed into `ManagementTab`.
- Schema conventions: every user-scoped table includes `userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' })`. New JSONB columns use `jsonb('column_name').notNull()`. New tables get an index `{table}_user_created_idx` on `(userId, createdAt)`.
- Migration workflow: Codex must run `npm run db:generate` after editing `lib/db/schema.ts` to produce a new `drizzle/00XX_<auto_slug>.sql`, then `npm run db:migrate` to apply it. **Never** use `npm run db:push` (false-positives on composite PKs corrupt the migration history).

---

### Change 1 — Add `playbook_strategies` table to schema

**File:** `lib/db/schema.ts`
**Action:** MODIFY

1. Append a new table definition at the bottom of the file (after `mdrTriggers`, currently ends at line 603). Insert the following block exactly:

   ```ts
   // Playbook strategies — one row per (user, strategy). The `sections` JSONB
   // holds all 7 free-form text sections so adding/removing a section later
   // doesn't require a migration. The `tag` column is plain text that must
   // match a trade tag (case-sensitive, exact) to drive the Recent Trades
   // panel on the Playbook page.
   export const playbookStrategies = pgTable('playbook_strategies', {
     id: text('id').primaryKey(),
     userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
     name: text('name').notNull(),
     description: text('description').notNull().default(''),
     tag: text('tag').notNull().default(''),
     sections: jsonb('sections').notNull(),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
   }, (t) => [
     index('playbook_strategies_user_created_idx').on(t.userId, t.createdAt),
   ]);
   ```

2. No existing imports need to change — `text`, `jsonb`, `timestamp`, `index`, `pgTable` are already imported at the top of the file.

**Expected behavior after Change 1:**
- `npx tsc --noEmit` passes.
- The exported symbol `playbookStrategies` is available from `@/lib/db/schema`.

---

### Change 2 — Generate and apply the migration

**File:** `drizzle/0041_<auto_slug>.sql` (generated)
**Action:** CREATE (via `drizzle-kit generate`)

1. From repo root run `npm run db:generate`. Drizzle will write a new file `drizzle/0041_<random_name>.sql`. Open it and verify:
   - It contains only `CREATE TABLE "playbook_strategies" ...` and `CREATE INDEX "playbook_strategies_user_created_idx" ...`.
   - It does **not** contain any `DROP` or `ALTER` statements. (If it does, the diff has dragged in unrelated drift — stop and report it.)
   - The foreign key to `users(id)` is present with `ON DELETE CASCADE`.

2. Apply with `npm run db:migrate`. (Never `db:push`.)

3. Commit the generated migration file along with the schema edit so the migration history stays linear.

**Expected behavior after Change 2:**
- A new file `drizzle/0041_<auto_slug>.sql` exists.
- The `playbook_strategies` table is created in the local DB.
- `drizzle/meta/_journal.json` has one new entry pointing at the new migration.

---

### Change 3 — Add Zod validation schemas

**File:** `lib/validations/playbook.ts`
**Action:** CREATE

1. Create the file with the following contents:

   ```ts
   import { z } from 'zod';

   // All sections are free-form text. Stored together as JSONB so adding
   // a new section is a code change, not a migration. Empty strings are
   // valid — a user can save a strategy with only Overview filled in.
   export const playbookSectionsSchema = z.object({
     overview: z.string(),
     checklist: z.string(),       // user types bullet lines, displayed as <ul>
     entry: z.string(),
     invalidation: z.string(),
     risk: z.string(),
     targets: z.string(),
     notes: z.string(),
   });

   export type PlaybookSections = z.infer<typeof playbookSectionsSchema>;

   export const createStrategySchema = z.object({
     name: z.string().min(1).max(200),
     description: z.string().max(1000).optional().default(''),
     tag: z.string().max(100).optional().default(''),
     sections: playbookSectionsSchema,
   });

   export type CreateStrategyInput = z.infer<typeof createStrategySchema>;

   export const updateStrategySchema = z.object({
     name: z.string().min(1).max(200).optional(),
     description: z.string().max(1000).optional(),
     tag: z.string().max(100).optional(),
     sections: playbookSectionsSchema.optional(),
   });

   export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>;
   ```

2. No exports from other files need to change.

**Expected behavior after Change 3:**
- `npx tsc --noEmit` passes; the schemas are importable from `@/lib/validations/playbook`.

---

### Change 4 — Add defaults for new strategies

**File:** `lib/playbook-defaults.ts`
**Action:** CREATE

1. Create the file with:

   ```ts
   import type { PlaybookSections } from '@/lib/validations/playbook';

   // Used when the user clicks "+ New Strategy" — every section starts empty
   // so the form renders all seven textareas without the user having to
   // delete placeholder text.
   export const EMPTY_PLAYBOOK_SECTIONS: PlaybookSections = {
     overview: '',
     checklist: '',
     entry: '',
     invalidation: '',
     risk: '',
     targets: '',
     notes: '',
   };

   // Display labels for the 7 sections, in the order the right panel
   // should render them. Keys must match PlaybookSections.
   export const PLAYBOOK_SECTION_ORDER: Array<{ key: keyof PlaybookSections; label: string; placeholder: string }> = [
     { key: 'overview',     label: 'Overview',          placeholder: 'What is this strategy in one paragraph?' },
     { key: 'checklist',    label: 'Pre-trade Checklist', placeholder: 'One bullet per line. e.g. price > 200MA' },
     { key: 'entry',        label: 'Entry Criteria',    placeholder: 'When do you take the trade?' },
     { key: 'invalidation', label: 'Invalidation',      placeholder: 'When do you NOT take the trade?' },
     { key: 'risk',         label: 'Risk / Stop',       placeholder: 'Where is the stop? How much do you risk?' },
     { key: 'targets',      label: 'Profit Targets',    placeholder: 'Where do you scale or take full profit?' },
     { key: 'notes',        label: 'Notes',             placeholder: 'Anything else worth remembering.' },
   ];
   ```

**Expected behavior after Change 4:**
- `npx tsc --noEmit` passes.

---

### Change 5 — Add `/api/playbook` route

**File:** `app/api/playbook/route.ts`
**Action:** CREATE

1. Create the directory and file. Mirror `app/api/career-pnl/route.ts` for shape. Contents:

   ```ts
   import { randomUUID } from 'crypto';
   import { and, asc, eq } from 'drizzle-orm';
   import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
   import { getDb } from '@/lib/db';
   import { playbookStrategies } from '@/lib/db/schema';
   import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
   import { createStrategySchema, updateStrategySchema } from '@/lib/validations/playbook';

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

       // Only set fields that were provided. Always bump updatedAt.
       const updates: Record<string, unknown> = { updatedAt: new Date() };
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
   ```

**Expected behavior after Change 5:**
- `GET /api/playbook` returns `{ strategies: [...] }` ordered by `createdAt ASC`.
- `POST /api/playbook` with a valid body returns `{ strategy: <row> }`.
- `PATCH /api/playbook?id=<uuid>` updates only the fields present in the body.
- `DELETE /api/playbook?id=<uuid>` returns `{ success: true, id }` or 404.
- Unauthenticated calls return whatever `requireUser()` returns (already-tested 401 path).

---

### Change 6 — Build the Playbook tab component

**File:** `components/trading/PlaybookTab.tsx`
**Action:** CREATE

1. Create the file. This is the largest single change in the spec — read it carefully end-to-end before pasting. Contents:

   ```tsx
   'use client';

   import { useEffect, useMemo, useState } from 'react';
   import { motion } from 'motion/react';
   import { ChevronRight, Plus, Save, Trash2 } from 'lucide-react';
   import { toast } from 'sonner';

   import { Button } from '@/components/ui/button';
   import { Input } from '@/components/ui/input';
   import { Textarea } from '@/components/ui/textarea';
   import { EMPTY_PLAYBOOK_SECTIONS, PLAYBOOK_SECTION_ORDER } from '@/lib/playbook-defaults';
   import { formatCurrency } from '@/lib/trading-utils';
   import type { Trade } from '@/lib/types';
   import type { PlaybookSections } from '@/lib/validations/playbook';

   interface Strategy {
     id: string;
     name: string;
     description: string;
     tag: string;
     sections: PlaybookSections;
     createdAt: string;
     updatedAt: string;
   }

   interface PlaybookTabProps {
     trades: Trade[];
   }

   // Recent Trades stats — computed across ALL trades carrying the tag,
   // not just the 10 shown. winRate is percentage 0..100. avgR is over
   // trades that have an initialRisk; trades without risk contribute to
   // count but not avgR. totalPnl uses netPnl.
   interface TagStats {
     count: number;
     wins: number;
     winRate: number;
     avgR: number | null;
     totalPnl: number;
   }

   function computeStats(matching: Trade[]): TagStats {
     if (matching.length === 0) {
       return { count: 0, wins: 0, winRate: 0, avgR: null, totalPnl: 0 };
     }
     const wins = matching.filter((t) => (t.netPnl ?? 0) > 0).length;
     const winRate = (wins / matching.length) * 100;
     const totalPnl = matching.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
     const rValues = matching
       .filter((t) => typeof t.initialRisk === 'number' && t.initialRisk! > 0)
       .map((t) => (t.netPnl ?? 0) / (t.initialRisk as number));
     const avgR = rValues.length > 0 ? rValues.reduce((s, x) => s + x, 0) / rValues.length : null;
     return { count: matching.length, wins, winRate, avgR, totalPnl };
   }

   export default function PlaybookTab({ trades }: PlaybookTabProps) {
     const [strategies, setStrategies] = useState<Strategy[]>([]);
     const [selectedId, setSelectedId] = useState<string | null>(null);
     const [loading, setLoading] = useState(true);
     const [saving, setSaving] = useState(false);

     // Load strategies on mount.
     useEffect(() => {
       let cancelled = false;
       (async () => {
         try {
           const res = await fetch('/api/playbook');
           if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
           const data = (await res.json()) as { strategies: Strategy[] };
           if (!cancelled) {
             setStrategies(data.strategies ?? []);
             if (data.strategies && data.strategies.length > 0) {
               setSelectedId(data.strategies[0].id);
             }
           }
         } catch (error) {
           console.error(error);
           if (!cancelled) toast.error('Failed to load playbook');
         } finally {
           if (!cancelled) setLoading(false);
         }
       })();
       return () => { cancelled = true; };
     }, []);

     const selected = useMemo(
       () => strategies.find((s) => s.id === selectedId) ?? null,
       [strategies, selectedId],
     );

     const matchingTrades = useMemo(() => {
       if (!selected || !selected.tag) return [] as Trade[];
       return trades
         .filter((t) => t.tags.includes(selected.tag))
         .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
     }, [trades, selected]);

     const stats = useMemo(() => computeStats(matchingTrades), [matchingTrades]);
     const lastTen = matchingTrades.slice(0, 10);

     const handleCreate = async () => {
       setSaving(true);
       try {
         const res = await fetch('/api/playbook', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             name: 'New Strategy',
             description: '',
             tag: '',
             sections: EMPTY_PLAYBOOK_SECTIONS,
           }),
         });
         if (!res.ok) throw new Error(`create failed: ${res.status}`);
         const data = (await res.json()) as { strategy: Strategy };
         setStrategies((cur) => [...cur, data.strategy]);
         setSelectedId(data.strategy.id);
         toast.success('Strategy created');
       } catch (error) {
         console.error(error);
         toast.error('Failed to create strategy');
       } finally {
         setSaving(false);
       }
     };

     const handleSave = async () => {
       if (!selected) return;
       setSaving(true);
       try {
         const res = await fetch(`/api/playbook?id=${selected.id}`, {
           method: 'PATCH',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             name: selected.name,
             description: selected.description,
             tag: selected.tag,
             sections: selected.sections,
           }),
         });
         if (!res.ok) throw new Error(`save failed: ${res.status}`);
         const data = (await res.json()) as { strategy: Strategy };
         setStrategies((cur) => cur.map((s) => (s.id === data.strategy.id ? data.strategy : s)));
         toast.success('Saved');
       } catch (error) {
         console.error(error);
         toast.error('Failed to save');
       } finally {
         setSaving(false);
       }
     };

     const handleDelete = async () => {
       if (!selected) return;
       if (!window.confirm(`Delete strategy "${selected.name}"?`)) return;
       try {
         const res = await fetch(`/api/playbook?id=${selected.id}`, { method: 'DELETE' });
         if (!res.ok) throw new Error(`delete failed: ${res.status}`);
         setStrategies((cur) => {
           const next = cur.filter((s) => s.id !== selected.id);
           setSelectedId(next.length > 0 ? next[0].id : null);
           return next;
         });
         toast.success('Deleted');
       } catch (error) {
         console.error(error);
         toast.error('Failed to delete');
       }
     };

     // Local edit helper — mutates the selected strategy in-place in state.
     // We don't autosave; the user has to click Save.
     const updateSelected = (patch: Partial<Strategy>) => {
       if (!selected) return;
       setStrategies((cur) => cur.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
     };

     const updateSection = (key: keyof PlaybookSections, value: string) => {
       if (!selected) return;
       updateSelected({ sections: { ...selected.sections, [key]: value } });
     };

     return (
       <motion.div
         key="playbook"
         initial={{ opacity: 0, y: 10 }}
         animate={{ opacity: 1, y: 0 }}
         exit={{ opacity: 0, y: -10 }}
         className="grid grid-cols-1 gap-4 px-1 lg:grid-cols-[280px_1fr]"
       >
         {/* Left column — strategies list */}
         <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
           <div className="flex items-baseline justify-between">
             <p className="text-sm font-medium text-white">Strategies</p>
             <p className="text-xs text-zinc-500">
               {strategies.length} {strategies.length === 1 ? 'strategy' : 'strategies'}
             </p>
           </div>

           <Button
             onClick={handleCreate}
             disabled={saving}
             className="mt-3 w-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
           >
             <Plus className="mr-1.5 h-4 w-4" />
             New Strategy
           </Button>

           <div className="mt-3 flex flex-col gap-2">
             {strategies.map((s) => (
               <button
                 key={s.id}
                 type="button"
                 onClick={() => setSelectedId(s.id)}
                 className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                   s.id === selectedId
                     ? 'border-emerald-500/40 bg-emerald-500/10'
                     : 'border-white/5 bg-white/5 hover:bg-white/10'
                 }`}
               >
                 <div className="min-w-0">
                   <p className="truncate text-sm font-medium text-zinc-100">{s.name}</p>
                   <p className="truncate text-xs text-zinc-500">{s.description || '—'}</p>
                 </div>
                 <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-500" />
               </button>
             ))}
             {strategies.length === 0 && !loading ? (
               <p className="px-1 py-4 text-center text-xs text-zinc-500">
                 Click "New Strategy" to create your first.
               </p>
             ) : null}
           </div>
         </div>

         {/* Right column — selected strategy detail */}
         <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
           {!selected ? (
             <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
               {loading ? 'Loading…' : 'Select a strategy on the left, or create a new one.'}
             </div>
           ) : (
             <div className="flex flex-col gap-4">
               {/* Header: name, tag, action buttons */}
               <div className="flex items-start justify-between gap-3">
                 <div className="flex-1">
                   <Input
                     value={selected.name}
                     onChange={(e) => updateSelected({ name: e.target.value })}
                     placeholder="Strategy name"
                     className="h-10 border-white/10 bg-white/5 text-base font-medium"
                   />
                   <Input
                     value={selected.description}
                     onChange={(e) => updateSelected({ description: e.target.value })}
                     placeholder="One-line description"
                     className="mt-2 h-9 border-white/10 bg-white/5 text-sm text-zinc-300"
                   />
                 </div>
                 <div className="flex gap-2">
                   <Button
                     onClick={handleSave}
                     disabled={saving}
                     className="h-9 border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                   >
                     <Save className="mr-1.5 h-4 w-4" />
                     Save
                   </Button>
                   <Button
                     onClick={handleDelete}
                     variant="ghost"
                     className="h-9 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                   >
                     <Trash2 className="h-4 w-4" />
                   </Button>
                 </div>
               </div>

               {/* Tag input */}
               <div>
                 <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">
                   Trade Tag (matches your existing trade tags exactly)
                 </p>
                 <Input
                   value={selected.tag}
                   onChange={(e) => updateSelected({ tag: e.target.value })}
                   placeholder="e.g. ParabolicShort"
                   className="h-9 border-white/10 bg-white/5 text-sm"
                 />
               </div>

               {/* 7 section textareas */}
               {PLAYBOOK_SECTION_ORDER.map((section) => (
                 <div key={section.key}>
                   <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">
                     {section.label}
                   </p>
                   <Textarea
                     value={selected.sections[section.key]}
                     onChange={(e) => updateSection(section.key, e.target.value)}
                     placeholder={section.placeholder}
                     className="min-h-[80px] border-white/10 bg-white/5 text-sm"
                   />
                 </div>
               ))}

               {/* Recent Trades panel */}
               <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                 <div className="flex items-baseline justify-between">
                   <p className="text-sm font-medium text-white">Recent Trades</p>
                   <p className="text-xs text-zinc-500">
                     {selected.tag ? `tag: ${selected.tag}` : 'set a tag above to populate'}
                   </p>
                 </div>

                 {selected.tag && stats.count > 0 ? (
                   <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
                     <span>{stats.count} trades</span>
                     <span>
                       Win rate: <span className="font-mono text-zinc-200">{stats.winRate.toFixed(0)}%</span>
                     </span>
                     <span>
                       Avg R: <span className="font-mono text-zinc-200">{stats.avgR === null ? '—' : stats.avgR.toFixed(2)}</span>
                     </span>
                     <span>
                       Total P/L:{' '}
                       <span className={`font-mono ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                         {formatCurrency(stats.totalPnl)}
                       </span>
                     </span>
                   </div>
                 ) : null}

                 {selected.tag && lastTen.length > 0 ? (
                   <table className="mt-3 w-full text-left text-xs">
                     <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                       <tr className="border-b border-white/5">
                         <th className="px-2 py-1.5">Date</th>
                         <th className="px-2 py-1.5">Symbol</th>
                         <th className="px-2 py-1.5">Dir</th>
                         <th className="px-2 py-1.5 text-right">P/L</th>
                       </tr>
                     </thead>
                     <tbody className="text-zinc-300">
                       {lastTen.map((t) => (
                         <tr key={t.id} className="border-b border-white/5 last:border-b-0">
                           <td className="px-2 py-1.5 font-mono">{t.sortKey}</td>
                           <td className="px-2 py-1.5 font-medium">{t.symbol}</td>
                           <td className="px-2 py-1.5">{t.direction}</td>
                           <td className={`px-2 py-1.5 text-right font-mono ${(t.netPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                             {formatCurrency(t.netPnl ?? 0)}
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 ) : selected.tag && stats.count === 0 ? (
                   <p className="mt-3 text-xs text-zinc-500">No trades found with this tag yet.</p>
                 ) : null}
               </div>
             </div>
           )}
         </div>
       </motion.div>
     );
   }
   ```

2. Verify `@/components/ui/textarea` exists at `components/ui/textarea.tsx`. If it doesn't, swap the `<Textarea>` for a plain `<textarea>` styled with `className="min-h-[80px] w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100"`.

**Expected behavior after Change 6:**
- `npx tsc --noEmit` passes.
- The component renders standalone (verify in Change 8's manual smoke).
- All edits are local until Save is pressed; refreshing the page before Save discards changes (this is intentional per the user's decision against autosave).

---

### Change 7 — Wire Playbook into ManagementTab

**File:** `components/trading/ManagementTab.tsx`
**Action:** MODIFY

1. Add `PlaybookTab` to the existing import block at the top of the file. Insert after the `PerformanceTab` import (currently line 9):

   ```ts
   import PlaybookTab from '@/components/trading/PlaybookTab';
   ```

2. Replace the `SubTabKey` type (currently line 14) and the `SUB_TABS` array (currently lines 18-24) with:

   ```ts
   type SubTabKey = 'journal' | 'trades' | 'performance' | 'playbook' | 'career-pnl' | 'archive';

   // Order matches the spec: Journal first, then Trades (formerly the standalone
   // "Management"/Trades tab), Performance, Playbook, Career P/L, Archive.
   const SUB_TABS: Array<{ key: SubTabKey; label: string }> = [
     { key: 'journal', label: 'Journal' },
     { key: 'trades', label: 'Trades' },
     { key: 'performance', label: 'Performance' },
     { key: 'playbook', label: 'Playbook' },
     { key: 'career-pnl', label: 'Career P/L' },
     { key: 'archive', label: 'Archive' },
   ];
   ```

3. Add a render branch for the new tab. Insert this block between the `'performance'` branch and the `'career-pnl'` branch (currently between lines 140 and 142):

   ```tsx
         {activeSubTab === 'playbook' ? <PlaybookTab trades={props.trades} /> : null}
   ```

4. Confirm `props.trades` is already passed in (it is — see `ManagementTabProps` line 27).

**Expected behavior after Change 7:**
- A new "Playbook" tab appears in the sub-nav between Performance and Career P/L.
- Clicking it renders `<PlaybookTab>` with all trades passed in.
- All existing tabs continue to work unchanged.

---

### Change 8 — Manual smoke test

**File:** N/A (runtime check)
**Action:** VERIFY

1. Run `npm run dev`. Open the app, sign in, go to Management → Playbook.
2. Confirm:
   - The sub-nav shows Playbook between Performance and Career P/L.
   - Left panel shows "Strategies", count "0 strategies", and a green "+ New Strategy" button.
   - Right panel shows "Select a strategy on the left, or create a new one."
3. Click **+ New Strategy**. Confirm:
   - A row "New Strategy" appears on the left and becomes selected.
   - Right panel renders with editable name, description, tag, and 7 textarea sections.
   - The Recent Trades panel at the bottom says "set a tag above to populate".
4. Type a name (e.g. "Parabolic Short"), a description, and a tag that you already use on one of your real trades (case-sensitive!). Fill in Overview and Pre-trade checklist with a couple bullet lines (`- line 1\n- line 2`). Click **Save**. Confirm toast "Saved".
5. Refresh the page. Confirm the strategy persisted and the data round-trips correctly.
6. Confirm the Recent Trades panel now shows:
   - Stats row: count, win rate %, avg R (or —), total P/L.
   - A table of up to 10 trades, newest first, with date / symbol / direction / P/L.
7. Click the trash icon. Confirm `window.confirm` fires and the strategy disappears after OK.

---

### Files Changed Summary

| File | Change | Risk |
|------|--------|------|
| `lib/db/schema.ts` | Add `playbookStrategies` table definition | Low — pure addition, no FK changes to other tables |
| `drizzle/0041_<auto_slug>.sql` | Generated migration (CREATE TABLE + CREATE INDEX) | Low — additive only; verify no DROP/ALTER before applying |
| `lib/validations/playbook.ts` | New Zod schemas (sections, create, update) | Trivial |
| `lib/playbook-defaults.ts` | New constants for empty sections + section ordering | Trivial |
| `app/api/playbook/route.ts` | New CRUD route (GET/POST/PATCH/DELETE), all user-scoped via `requireUser()` | Low — mirrors `career-pnl/route.ts` |
| `components/trading/PlaybookTab.tsx` | New tab component (two-column layout, fetches/saves, computes Recent Trades stats client-side) | Medium — largest single file, but no shared-state coupling outside `trades` prop |
| `components/trading/ManagementTab.tsx` | Add `'playbook'` to `SubTabKey`, `SUB_TABS`, and one render branch | Low — additive |

Estimated total: 7 files touched (5 created, 2 modified), ~500 lines added, ~3 lines removed.

---

### Verification Steps

Run in order from repo root:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. After Change 1 only, run `npm run db:generate` and **inspect the generated SQL** before running `npm run db:migrate`. Confirm: only `CREATE TABLE "playbook_strategies"` + `CREATE INDEX "playbook_strategies_user_created_idx"`. No `DROP`, no `ALTER` on other tables.
5. `npm run db:migrate`
6. `npm run workflow:audit` (only required if any file under `AGENTS.md`, `HANDOFF.md`, `.claude/`, `.opencode/`, or `codex-skills/` changed — for this spec, none of those are touched, so skip unless you've also edited workflow files).

Manual smoke (per Change 8 above). All 7 checks must pass.

---

### Open Questions

None. All scope was confirmed via Q&A on 2026-05-21 (Recent Trades = last 10 + win%/avgR/total P/L; checklist = static reference; tag = free-text; ordering = createdAt + delete-in-header).

If you hit an unexpected condition (e.g. `@/components/ui/textarea` doesn't exist), apply the fallback noted in Change 6 step 2 and continue — don't pause to ask.

---

## Session Maintenance Checklist

- [x] Read this file before starting.
- [x] If the active context drifts from the live repo, update the context or stop and ask before editing.
- [x] Implement Changes 1–8 in the order listed above. Schema + migration must land before the API route (Change 5 imports `playbookStrategies`).
- [x] Run the Verification Steps before reporting work complete.
- [x] Do not push to remote without explicit user instruction.
- [x] Do not modify `.env*` or secret files.
- [x] Use `npm run db:migrate`, never `db:push`.
