# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-10
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-16, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Sheets Sprints 1-7 + Massive Wave 1-2, backtest user-id fixes, Filing headline parser, Calendar Year Overview, Workflow Maintenance, Nav Reorg, Sheets Today-filter + report-by-ticker/date, EODHD News API swap) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## Active Spec: Playbook Auto-Save Drafts + Font-Size Control

> Generated: 2026-06-11 | Author: Claude (plan)
> Status: PLANNED

Two independent additions to the Playbook rich-text trial:
- **Part A — Auto-save drafts:** unsaved Playbook edits are mirrored to `localStorage`
  so refresh / tab-close / sub-tab switch / top-nav switch never lose work. Fully
  self-contained in `PlaybookTab.tsx` (no ManagementTab / page.tsx changes). A small
  "Unsaved draft" pill shows while a strategy has a pending local draft.
- **Part B — Font-size control:** a compact preset dropdown (Default / Small / Normal /
  Large / Huge) added to the Tiptap bubble toolbar. Size is stored as inline
  `style="font-size:Npx"` in the same HTML string — no DB migration.

Decisions locked with Jared: drafts approach (not a blocking warning); preset-size
dropdown (not numeric stepper); show the unsaved-draft pill.

---

### Part A — Auto-save drafts

**File:** `components/trading/PlaybookTab.tsx` — **MODIFY**

A1. Add module-level draft helpers. Anchor: immediately **after** the `nextFieldId`
function (the `}` near line 80) and **before** `export default function PlaybookTab`.
Insert:
```ts
const DRAFTS_KEY = 'nexus-playbook-drafts';
type StrategyDraft = Pick<Strategy, 'name' | 'description' | 'tag' | 'sections'>;

function readDrafts(): Record<string, StrategyDraft> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StrategyDraft>) : {};
  } catch {
    return {};
  }
}

function writeDrafts(drafts: Record<string, StrategyDraft>): void {
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore storage failures (private browsing / quota).
  }
}
```
(`Strategy` is the existing interface at the top of the file; `Pick` is built-in TS.)

A2. Add draft-tracking state. Anchor: after the existing
`const [editingTemplate, setEditingTemplate] = useState(false);` line. Insert:
```ts
// Strategy ids that currently have an unsaved local draft (drives the pill).
const [draftedIds, setDraftedIds] = useState<Set<string>>(new Set());
```

A3. Overlay drafts on load + prune orphans. In the load `useEffect`, **replace** this
existing block:
```ts
          const nextStrategies = stratData.strategies ?? [];
          setStrategies(nextStrategies);
          if (nextStrategies.length > 0) {
            setSelectedId(nextStrategies[0].id);
          }
```
with:
```ts
          const fetched = stratData.strategies ?? [];
          const drafts = readDrafts();
          const validIds = new Set(fetched.map((strategy) => strategy.id));
          // Drop drafts whose strategy no longer exists, then persist if changed.
          let pruned = false;
          for (const id of Object.keys(drafts)) {
            if (!validIds.has(id)) {
              delete drafts[id];
              pruned = true;
            }
          }
          if (pruned) writeDrafts(drafts);
          const nextStrategies = fetched.map((strategy) => (
            drafts[strategy.id] ? { ...strategy, ...drafts[strategy.id] } : strategy
          ));
          setStrategies(nextStrategies);
          setDraftedIds(new Set(Object.keys(drafts)));
          if (nextStrategies.length > 0) {
            setSelectedId(nextStrategies[0].id);
          }
```

A4. Persist a draft on every edit. **Replace** the existing `updateSelected`:
```ts
  const updateSelected = (patch: Partial<Strategy>) => {
    if (!selected) return;
    setStrategies((current) => current.map((strategy) => (
      strategy.id === selected.id ? { ...strategy, ...patch } : strategy
    )));
  };
```
with:
```ts
  const updateSelected = (patch: Partial<Strategy>) => {
    if (!selected) return;
    const merged = { ...selected, ...patch };
    setStrategies((current) => current.map((strategy) => (
      strategy.id === selected.id ? merged : strategy
    )));
    const drafts = readDrafts();
    drafts[selected.id] = {
      name: merged.name,
      description: merged.description,
      tag: merged.tag,
      sections: merged.sections,
    };
    writeDrafts(drafts);
    setDraftedIds((current) => (
      current.has(selected.id) ? current : new Set(current).add(selected.id)
    ));
  };
```
(`updateSection` already routes through `updateSelected`, so section edits are covered.)

A5. Clear the draft after a successful save. In `handleSave`, **after** this existing
success line:
```ts
      setStrategies((current) => current.map((strategy) => (
        strategy.id === data.strategy.id ? data.strategy : strategy
      )));
```
insert:
```ts
      const drafts = readDrafts();
      delete drafts[data.strategy.id];
      writeDrafts(drafts);
      setDraftedIds((current) => {
        if (!current.has(data.strategy.id)) return current;
        const next = new Set(current);
        next.delete(data.strategy.id);
        return next;
      });
```

A6. Clear the draft after a successful delete. In `handleDelete`, **after** the
`setStrategies((current) => { ... })` block and **before** `toast.success('Deleted');`,
insert:
```ts
      const drafts = readDrafts();
      delete drafts[selected.id];
      writeDrafts(drafts);
      setDraftedIds((current) => {
        if (!current.has(selected.id)) return current;
        const next = new Set(current);
        next.delete(selected.id);
        return next;
      });
```

A7. Show the "Unsaved draft" pill. Anchor: inside the `selected` branch of the render,
**after** the closing `</div>` of the `flex flex-col gap-2` block that holds the name and
description rows, and **before** the `{editingTemplate ? (` block. Insert:
```tsx
            {draftedIds.has(selected.id) ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                Unsaved draft saved in this browser — hit Save to store it.
              </p>
            ) : null}
```
(`selected` is non-null in this branch.)

---

### Part B — Font-size preset dropdown

**File:** `package.json` — **MODIFY**

B1. Add the dependency. Keep `dependencies` alphabetized: it goes **before**
`"@tiptap/react"` (currently line 27), i.e. between `"@neondatabase/serverless"` and
`"@tiptap/react"`:
```json
    "@tiptap/extension-text-style": "^3.26.1",
```
Then run `npm install` so `package-lock.json` updates (do NOT hand-edit the lockfile).

**File:** `components/ui/rich-text-editor.tsx` — **MODIFY**

B2. Add the import. **After** the `import StarterKit from '@tiptap/starter-kit';` line:
```ts
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
```
(Both are named exports of the package root — verified against v3.26.1.)

B3. Register the extensions. In the `useEditor` `extensions` array, **after** the
`StarterKit.configure({ ... })` entry, add `TextStyle` and `FontSize`:
```ts
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: { openOnClick: false, autolink: true },
      }),
      TextStyle,
      FontSize,
    ],
```
(`FontSize` augments the editor with `setFontSize` / `unsetFontSize` and depends on the
`textStyle` mark `TextStyle` provides — order matters, keep `TextStyle` first.)

B4. Add the size dropdown to the bubble toolbar. **Immediately before** the closing
`</BubbleMenu>` tag (after the existing Link `<button ...>` for `setLink`), insert:
```tsx
        <span className="mx-0.5 h-4 w-px bg-border" />
        <select
          value={(editor.getAttributes('textStyle').fontSize as string | undefined) ?? ''}
          onChange={(event) => {
            const size = event.target.value;
            if (size === '') {
              editor.chain().focus().unsetFontSize().run();
            } else {
              editor.chain().focus().setFontSize(size).run();
            }
          }}
          aria-label="Font size"
          className="h-7 rounded border border-transparent bg-card px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none"
        >
          <option value="">Default</option>
          <option value="12px">Small</option>
          <option value="14px">Normal</option>
          <option value="18px">Large</option>
          <option value="24px">Huge</option>
        </select>
```

---

### Part C — Keep the test suite isolated

**File:** `__tests__/playbook-tab.test.tsx` — **MODIFY**

C1. The new draft logic writes to `localStorage` during render/edit, and jsdom keeps
`localStorage` across tests in a file. Add a clear to the existing `beforeEach` so drafts
don't leak between tests. **Replace**:
```ts
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
```
with:
```ts
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });
```

---

### Files Changed Summary

| File | Action | ~Lines | Risk |
| --- | --- | --- | --- |
| `components/trading/PlaybookTab.tsx` | MODIFY | +55 / -6 | Medium |
| `components/ui/rich-text-editor.tsx` | MODIFY | +20 | Low |
| `package.json` | MODIFY | +1 | Low |
| `package-lock.json` | MODIFY (npm) | (generated) | Low |
| `__tests__/playbook-tab.test.tsx` | MODIFY | +1 | Low |

### Verification Steps

1. `npm install` (adds `@tiptap/extension-text-style`).
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm test`
5. `npm run build` (new dependency — build catches Vercel-only breaks that lint/tsc miss).
6. Manual smoke (dev server):
   - Edit a Playbook section, do NOT hit Save, **refresh the page** → edit is restored and
     an amber "Unsaved draft" pill shows. Hit Save → pill disappears, edit persists.
   - Edit, switch Management sub-tab away and back → edit still there.
   - Select text → bubble toolbar shows a size dropdown; pick Large/Huge → selection
     resizes; pick Default → size clears. Save + reload → size persists.
   - Delete a strategy that had a draft → no stale draft resurrects it on reload.

### Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

### Acceptance Criteria

- [ ] Editing a Playbook section without saving survives a full page refresh (draft restored).
- [ ] An amber "Unsaved draft" pill shows for a strategy with a pending draft and clears on Save.
- [ ] Saving a strategy clears its draft; deleting a strategy clears its draft.
- [ ] Orphan drafts (strategy no longer returned by the API) are pruned on load.
- [ ] `localStorage` access is wrapped so private-browsing / quota failures don't throw.
- [ ] Bubble toolbar has a Default/Small/Normal/Large/Huge size dropdown that sets and clears font size on the selection.
- [ ] Font size persists in the saved HTML and re-renders after reload.
- [ ] No DB/schema changes; `sections` is still a plain string map.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all pass.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

---

## Recently Completed

### Playbook Rich Text Editor (Tiptap trial)

Status: completed 2026-06-11 (commit `6423d3a`, reviewed against spec).

Outcome:
- Playbook section inputs are now a Notion-style rich-text editor (`components/ui/rich-text-editor.tsx`, Tiptap v3 StarterKit): markdown typing shortcuts + selection bubble toolbar (H1–H3, bold/italic/underline/strike, lists, quote, inline code, links).
- Content stored as HTML in the existing `sections` string map — no DB migration; legacy plain-text playbooks convert on load and stay editable.
- Side fix: repaired a pre-existing stale mock in `backtest-chart-grid.test.tsx` (broken by commit `3cf8559`'s `onToggleExpanded`→`onSelectView` rename) so the suite is green.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (829 tests), `npm run build` — all pass.
- Manual smoke by Jared: every shortcut/feature tested in dev, all good.

### News Section Redesign — Headline List + Inline Article Reader

Status: completed 2026-06-10 (commit `3dabcd0`, reviewed against spec).

Outcome:
- Research News tab is now a two-level UI: a card list of headlines (`relative time · absolute datetime · bold title`, no source label) that swaps into a full inline article reader with `← Back`, a `$TICKER` badge, long datetime, optional "Open original ↗", and the body split into paragraphs.
- Added `url` to `ResearchSnapshotNewsItem` (sourced from EODHD `link`) and two formatters in `lib/askedgar-utils.ts` (`formatRelativeTime`, `formatDateTimeLong`); dropped the dead Groq/JMT415 `formType` source logic.
- Post-review tweak: article body bumped `text-sm` → `text-base` per Jared.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (825 tests) — all pass.
- Manual dev-server smoke by Jared: list, reader swap, and "Open original" all good.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
