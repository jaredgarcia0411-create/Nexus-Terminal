# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-01
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

### Sheets - Sprint 1: Data Layer

Status: completed 2026-06-01 (commit `176e525`).

Outcome:
- 3-table model shipped (`sheets`, `sheet_rows`, `sheet_members`) with migration `0045`, columns folded into a `columns` jsonb + `columnsVersion` guard.
- Access-checked routes from day one via `getSheetRole`: list/create, get/patch/delete (owner-only edits), duplicate, row append + optimistic-version patch/delete.
- Validation in `lib/validations/sheets.ts` (hard bounds) + 12 vitest cases.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (736 passed) all green.
- Migration generated + applied (`npm run db:migrate`).

### Sheets - Sprint 2: Management UI + Editable Grid

Status: completed 2026-06-01 (commit `da1bba0`).

Outcome:
- First Sheets UI: `Sheets` subtab under Management — list rail, create/rename/duplicate/delete, `react-data-grid` editable grid with text/select/checkbox editors, optimistic save with 409 conflict toasts.
- `hooks/use-sheets.ts` owns all data + mutations; pure grid helpers in `lib/sheets/grid.ts` (unit-tested).
- Grid themed via `.sheets-grid` mapping `--rdg-*` vars onto app semantic tokens (follows light/dark).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (740 passed) all green.
- Authenticated browser smoke not run (no `agent-browser` in Codex sandbox); deferred surfaces (`report`/`chart`/`action` cells, tag options, sharing) are not built yet, not broken.

Known cosmetic debt (rolled into Sprint 3): `SheetFormDialog` date input + `AddColumnDialog` type select dropped the `[color-scheme:dark]` class the rest of the app uses.

### Roadmap (deferred from Sprints 1-2)
- **Sprint 3 (implemented below; manual authenticated smoke pending): sharing/members.**
- Research "Add to Sheets" import + interactive `report`/`chart`/`action` cells.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation, drag-reorder rows/columns.
- `AGENTS.md` update once sharing + import land (document the full surface at once).

---

## Sheets - Sprint 3: Sharing / Members

> Generated: 2026-06-01 | Agent: Claude (Plan)
> Status: IMPLEMENTED - automated validation passed 2026-06-01; manual authenticated smoke remains pending.

Outcome:
- Added owner-only member routes for add-by-email, editor/viewer role changes, and member removal while preserving immutable owner membership.
- Wired `use-sheets` member mutations into a new owner-only Share dialog in `SheetsTab`.
- Cleared the Sprint-2 native control color-scheme debt and added member validation coverage.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (744 passed) all green.
- Manual authenticated sharing smoke was not run in this session.

### Context

Sprints 1-2 shipped the data layer + the single-user grid. Every sheet already has a `sheet_members` row per member (owner created on insert), `getSheetRole` already gates every route, and `GET /api/sheets/[id]` already returns `members: { userId, role, name, email }[]` and the caller's `role`. The grid already enforces owner/editor/viewer in the UI. **What's missing is the ability to actually add, re-role, or remove other people.** This sprint builds that: three owner-only member routes, hook wiring, and a Share dialog opened from the sheet header. It also clears the Sprint-2 `[color-scheme:dark]` cosmetic debt.

**Locked facts (do not re-derive):**
- `sheetMembers` PK is `(sheetId, userId)`, `role` enum `'owner' | 'editor' | 'viewer'` default `'editor'` (`lib/db/schema.ts:682`).
- Role check helper: `getSheetRole(db, sheetId, userId)` in `lib/sheets/access.ts` returns the role or `null`.
- Users only exist in the `users` table **after they have signed in at least once** (`ensureUser` upserts them on their own authenticated requests). So an invite-by-email can only target someone who has already logged in. If no user row matches, return a clear "they need to sign in first" error — do NOT create a placeholder user row.
- Owner is identified by `sheets.ownerUserId` AND by the member row whose `role = 'owner'`. The owner's membership is immutable: never let the API change or delete it, and never assign `'owner'` via these routes.
- Route conventions (mirror `app/api/sheets/[id]/route.ts` exactly): `requireUser()` → `getDb()` + `dbUnavailable()` → `ensureUser(db, authState.user)` → `getSheetRole` → owner gate returns `403`; non-member returns `404`. Validate bodies with `parseAndValidate(request, schema)`. Wrap in try/catch with `logRouteError('<tag>', error)` + `internalServerError()`.

**Design conventions:** semantic tokens only (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-accent`, `bg-primary/10 text-primary`, `text-rose-400`). Mirror `components/trading/SheetFormDialog.tsx` and `AddColumnDialog.tsx` for the dialog shell, fetch/error/submit pattern. Native `<select>` and `type="date"` inputs MUST carry `[color-scheme:dark]` (the established convention — see `ArchiveTab.tsx`, `CareerPnlTab.tsx`, `BacktestingTab.tsx`).

---

### Step 1 — Validation schemas for member mutations

**File:** `lib/validations/sheets.ts` — MODIFY (append after `rowPatchSchema`, before the `export type` block)

Add two schemas. Roles assignable via the API are only `editor`/`viewer` — `owner` is never accepted.

```ts
export const memberAddSchema = z.object({
  email: z.string().trim().toLowerCase().email('a valid email is required').max(200),
  role: z.enum(['editor', 'viewer']).default('editor'),
});

export const memberRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});
```

Then add to the type-export block at the bottom:

```ts
export type MemberAddBody = z.infer<typeof memberAddSchema>;
export type MemberRoleBody = z.infer<typeof memberRoleSchema>;
```

**Acceptance:** `memberAddSchema` lowercases + validates the email and defaults `role` to `editor`; both schemas reject `role: 'owner'`.

---

### Step 2 — Add-member route

**File:** `app/api/sheets/[id]/members/route.ts` — CREATE

`POST` only. Owner-only. Looks up the target user by email; upserts a membership.

```ts
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
```

> **Verify:** confirm `onConflictDoUpdate`'s `target` accepts the composite-key column array in this Drizzle version (it does for `pgTable` composite PKs). If the import path for `parseAndValidate`/`logRouteError`/`internalServerError` differs, copy it verbatim from `app/api/sheets/[id]/route.ts`.

**Acceptance:** owner can add an existing user as editor/viewer; re-adding an existing member updates their role (idempotent); adding an unknown email → 404 with the sign-in message; adding the owner → 400; non-owner → 403; non-member → 404.

---

### Step 3 — Change-role + remove-member route

**File:** `app/api/sheets/[id]/members/[userId]/route.ts` — CREATE

`PATCH` (change role) + `DELETE` (remove). Both owner-only and both refuse to touch the owner's own membership.

```ts
import { and, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetMembers, sheets } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { memberRoleSchema } from '@/lib/validations/sheets';

async function loadOwnerGate(sheetId: string, userId: string) {
  const db = getDb();
  if (!db) return { error: dbUnavailable() as Response };
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
    if ('error' in gate) return gate.error;
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
    if ('error' in gate) return gate.error;
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
```

> **Simplicity note:** `loadOwnerGate` is shared by both handlers in this one file — it's a single-file local helper with two callers, which is allowed. It calls `getDb()` again internally; the handlers also call `getDb()` for the mutation. That double call is cheap (memoized client) and keeps each handler readable. If Codex prefers, inline the gate into each handler instead — either is fine. Do NOT export the helper.

**Acceptance:** owner can change a member editor↔viewer and remove a member; targeting the owner's `userId` → 400; non-owner → 403; PATCH of a non-member → 404.

---

### Step 4 — Hook: member mutations

**File:** `hooks/use-sheets.ts` — MODIFY

Add three callbacks that update the in-memory `members` array (no full reload needed — these routes return the changed member). Insert after `updateColumns`, and add all three to the returned object.

```ts
const addMember = useCallback(async (email: string, role: 'editor' | 'viewer') => {
  if (!activeSheet) return;
  const res = await sendJson(`/api/sheets/${activeSheet.id}/members`, { email, role });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    toast.error(data?.error ?? 'Failed to add member');
    throw new Error('add member failed');
  }
  const data = (await res.json()) as { member: SheetMember };
  setMembers((current) => {
    const without = current.filter((m) => m.userId !== data.member.userId);
    return [...without, data.member];
  });
  toast.success('Member added');
}, [activeSheet]);

const updateMemberRole = useCallback(async (userId: string, role: 'editor' | 'viewer') => {
  if (!activeSheet) return;
  const res = await sendJson(`/api/sheets/${activeSheet.id}/members/${userId}`, { role }, 'PATCH');
  if (!res.ok) { toast.error('Failed to update role'); return; }
  setMembers((current) => current.map((m) => (m.userId === userId ? { ...m, role } : m)));
}, [activeSheet]);

const removeMember = useCallback(async (userId: string) => {
  if (!activeSheet) return;
  const res = await fetch(`/api/sheets/${activeSheet.id}/members/${userId}`, { method: 'DELETE' });
  if (!res.ok) { toast.error('Failed to remove member'); return; }
  setMembers((current) => current.filter((m) => m.userId !== userId));
}, [activeSheet]);
```

`addMember` re-throws on failure so the dialog can keep itself open and surface the server's specific message (same pattern Sprint 2 used for `createSheet`). Add `addMember, updateMemberRole, removeMember` to the `return { ... }` object.

**Acceptance:** hook exposes `addMember`, `updateMemberRole`, `removeMember`; each updates `members` locally; `addMember` rethrows on failure.

---

### Step 5 — Share dialog

**File:** `components/trading/ShareSheetDialog.tsx` — CREATE

Lists members (owner row is read-only with an "Owner" badge), lets the owner change a role or remove a member, and has an add-by-email form. Mirror `AddColumnDialog.tsx`'s shell.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SheetMember } from '@/hooks/use-sheets';

interface ShareSheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: SheetMember[];
  ownerUserId: string;
  onAdd: (email: string, role: 'editor' | 'viewer') => Promise<void>;
  onChangeRole: (userId: string, role: 'editor' | 'viewer') => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}

export default function ShareSheetDialog({
  open,
  onOpenChange,
  members,
  ownerUserId,
  onAdd,
  onChangeRole,
  onRemove,
}: ShareSheetDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('editor');
    setError(null);
    setSubmitting(false);
  }, [open]);

  const handleAdd = async () => {
    const trimmed = email.trim();
    if (!trimmed) { setError('Email is required'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(trimmed, role);
      setEmail('');
    } catch {
      setError('Could not add that person. Check the email and that they have signed in before.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share Sheet</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>People with access</Label>
            <div className="space-y-1">
              {members.map((member) => {
                const isOwner = member.userId === ownerUserId;
                return (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-accent/40 px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{member.name ?? member.email ?? member.userId}</p>
                      {member.email ? <p className="truncate text-xs text-muted-foreground">{member.email}</p> : null}
                    </div>
                    {isOwner ? (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">Owner</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <select
                          value={member.role === 'viewer' ? 'viewer' : 'editor'}
                          onChange={(event) => void onChangeRole(member.userId, event.target.value as 'editor' | 'viewer')}
                          className="h-8 rounded-md border border-border bg-accent px-2 text-sm text-foreground [color-scheme:dark]"
                        >
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void onRemove(member.userId)}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-500/40 text-rose-400 transition-colors hover:bg-rose-500/10"
                          aria-label={`Remove ${member.email ?? member.userId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="share-email">Invite by email</Label>
            <div className="flex items-center gap-2">
              <Input
                id="share-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                className="border-border bg-accent text-foreground"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as 'editor' | 'viewer')}
                className="h-9 rounded-md border border-border bg-accent px-2 text-sm text-foreground [color-scheme:dark]"
              >
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
          </div>

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="bg-accent hover:bg-accent/80"
          >
            Done
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => void handleAdd()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Acceptance:** dialog lists every member; owner row shows an "Owner" badge and no controls; non-owner rows have an editor/viewer select + remove button; the invite form adds by email and clears on success, and shows the server error on failure.

---

### Step 6 — Wire Share into SheetsTab

**File:** `components/trading/SheetsTab.tsx` — MODIFY

1. Import the dialog and a `Users` icon:
   ```ts
   import { Columns3, Copy, FileSpreadsheet, Pencil, Plus, Trash2, Users } from 'lucide-react';
   import ShareSheetDialog from '@/components/trading/ShareSheetDialog';
   ```
2. Add `const [shareOpen, setShareOpen] = useState(false);` alongside the other dialog state.
3. Destructure `members` from the hook: `const { activeSheet, role, rows, members } = sheets;`
4. In the header action row, add a **Share** button gated by `canManage`, next to Rename:
   ```tsx
   {canManage ? (
     <Button
       type="button"
       variant="secondary"
       onClick={() => setShareOpen(true)}
       className="h-8 bg-accent hover:bg-accent/80"
     >
       <Users className="h-4 w-4" />
       Share
     </Button>
   ) : null}
   ```
5. Render the dialog next to the others at the bottom (only when there's an active sheet so `ownerUserId` is defined):
   ```tsx
   {activeSheet ? (
     <ShareSheetDialog
       open={shareOpen}
       onOpenChange={setShareOpen}
       members={members}
       ownerUserId={activeSheet.ownerUserId}
       onAdd={sheets.addMember}
       onChangeRole={sheets.updateMemberRole}
       onRemove={sheets.removeMember}
     />
   ) : null}
   ```

**Acceptance:** owner sees a Share button that opens the dialog; editor/viewer never see it; member changes made in the dialog reflect immediately in the member list.

---

### Step 7 — Clear Sprint-2 color-scheme debt

Native pickers/dropdowns must follow the dark theme like every other one in the app.

1. **`components/trading/SheetFormDialog.tsx`** — the `type="date"` Input (`id="sheet-date"`): append `[color-scheme:dark]` to its `className` → `"border-border bg-accent text-foreground [color-scheme:dark]"`.
2. **`components/trading/AddColumnDialog.tsx`** — the type `<select>` (`id="col-type"`): append `[color-scheme:dark]` to its `className`.

**Acceptance:** the Sheet date picker and the Add-Column type dropdown render with dark chrome, matching `ArchiveTab`/`CareerPnlTab`.

---

### Step 8 — Tests for member validation

**File:** `__tests__/sheets-members.test.ts` — CREATE

Pure schema coverage (no DB/route). Mirrors the existing `sheets` validation tests' style.

```ts
import { describe, expect, it } from 'vitest';

import { memberAddSchema, memberRoleSchema } from '@/lib/validations/sheets';

describe('sheet member validation', () => {
  it('lowercases the email and defaults role to editor', () => {
    const parsed = memberAddSchema.parse({ email: 'Trader@Example.COM' });
    expect(parsed).toEqual({ email: 'trader@example.com', role: 'editor' });
  });

  it('rejects an invalid email', () => {
    expect(memberAddSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('refuses to assign the owner role', () => {
    expect(memberAddSchema.safeParse({ email: 'a@b.com', role: 'owner' }).success).toBe(false);
    expect(memberRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('accepts editor and viewer for a role change', () => {
    expect(memberRoleSchema.parse({ role: 'viewer' })).toEqual({ role: 'viewer' });
    expect(memberRoleSchema.parse({ role: 'editor' })).toEqual({ role: 'editor' });
  });
});
```

**Acceptance:** all four tests pass.

---

### Files Changed Summary

| File | Action | ~Lines | Risk |
|---|---|---|---|
| `lib/validations/sheets.ts` | MODIFY (2 schemas + 2 types) | +12 | Low |
| `app/api/sheets/[id]/members/route.ts` | CREATE (POST) | ~65 | Medium (email lookup, upsert) |
| `app/api/sheets/[id]/members/[userId]/route.ts` | CREATE (PATCH+DELETE) | ~90 | Medium (owner-guard) |
| `hooks/use-sheets.ts` | MODIFY (3 callbacks + return) | +35 | Low |
| `components/trading/ShareSheetDialog.tsx` | CREATE | ~150 | Low |
| `components/trading/SheetsTab.tsx` | MODIFY (button + dialog wiring) | +25 | Low |
| `components/trading/SheetFormDialog.tsx` | MODIFY (color-scheme) | +0 | Low |
| `components/trading/AddColumnDialog.tsx` | MODIFY (color-scheme) | +0 | Low |
| `__tests__/sheets-members.test.ts` | CREATE | ~30 | Low |

### Verification Steps

Run from repo root after implementation:

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test` (new `sheets-members` tests pass; full suite green: 104 files / 744 tests)

No migration this sprint (no schema change — `sheet_members` already exists). `npm run typecheck:services` not required (no `services/` files).

**Manual smoke (pending — do before marking complete):**
- [ ] As owner, open Share → see yourself as "Owner".
- [ ] Invite a coworker's email who has logged in → they appear as editor; flip them to viewer; remove them.
- [ ] Invite an email no one has used → see the "sign in once first" error, no row added.
- [ ] Log in as that coworker → the sheet shows up in their list with the granted role; viewer sees a read-only grid, editor can edit rows but sees no Column/Rename/Share/Delete.

### Deferred to later sprints (do NOT build now)
- Self-leave (a non-owner removing their own membership), ownership transfer.
- Email notifications / invite links for people who haven't signed in.
- Research "Add to Sheets" import + interactive `report`/`chart`/`action` cells.
- CSV export, archive/unarchive UI, polling/SSE invalidation, drag-reorder.
- `AGENTS.md` update — defer until the import sprint so we document the full surface at once.

### Notes for Codex
- Build in file order: schemas → routes → hook → dialog → tab wiring → color-scheme → tests, so each layer compiles before the next depends on it.
- Copy the route boilerplate (`requireUser`/`getDb`/`ensureUser`/`getSheetRole`/try-catch) verbatim from `app/api/sheets/[id]/route.ts` — do not reinvent it.
- The owner's membership is sacred: never assign/change/remove `owner` via these routes. If a guard feels redundant, keep it — it's a security boundary, not internal defensive code.

---

## Implementation Style

Write the simplest correct code that satisfies the active spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless the spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries: user input, external APIs, and DB reads of untrusted JSON.
- No comments unless the why is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
