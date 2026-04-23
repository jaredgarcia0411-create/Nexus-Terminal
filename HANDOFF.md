# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-23
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20); Spend Enforcement Fix shipped across `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix shipped in `0e96e16` (2026-04-22); Research Chart History Polish shipped in `5fc5b9e` (2026-04-22). See git history for full records.

## Current State

**Active spec:** None. System Sheet Sync completed below.

## Validation Snapshot

Most recent validation (`2026-04-23`, System Sheet Sync):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`55` files, `424` tests)

## Follow-Up Notes

- Latent bug to investigate separately: `lib/askedgar.ts:840` reads `intraday_high` as the primary key for the gap-stats high field, but the AskEdgar `/v1/gap-stats` endpoint actually returns `high_price`. The research blueprints bypass the canonical mapper (reading `rawData['gap-stats']` directly) so this does not currently break research reports, but any other consumer of the mapped snapshot's `gapStats` array will see `intradayHigh: null` on every row. File a dedicated spec if/when another feature depends on the mapped snapshot.
- Ask Edgar replacement research was saved to `docs/ae-buildout.md` on 2026-04-23. `FUTURE-PLANS.md` and `AGENTIC_EXPANSIONV2.md` were moved into `docs/` to keep planning material consolidated.

---

## System Sheet Sync

> Generated: 2026-04-23 | Agent: plan (inline)
> Status: COMPLETED 2026-04-23

### Goal

Jared and his coworkers share a Google Sheet ("Agenda Database V3 - MAXIMILLION") that logs every ticker they trade through the team's system, with ticker-level metadata plus up to 4 trigger attempts per ticker (each attempt has 6 nested stages: Starter → 5M Trig → 5M Trig Sub 30% → Pop Back to VWAP → 5M Close Sub Piv → Exit).

We want this data in Postgres so a future co-pilot agent can query aggregations across the system (e.g. "avg R by setup type", "which trigger type works best on gap-downs"). No UI display of the data itself — only a sync button. Agent wiring is a separate future task.

**Import source:** CSV upload (Jared already downloads the sheet regularly). Live Google Sheets API is explicitly deferred until manual upload becomes annoying.

### Approved decisions (locked)

1. **Single shared table `system_tickers`, no `user_id`.** Everyone sees the same rows. This matches the model already used by `askedgar_cache` (shared, no user scoping).
2. **Hybrid flat + JSONB schema.** Ticker-level fields that the agent will filter/group by get flat columns. Trigger-attempt detail (4 attempts × 6 stages × ~8 fields each) goes into a single `attempts_json` JSONB column. The full parsed row (every CSV column, including fields not lifted to flat cols) is preserved in `raw_json` JSONB as insurance against future "I need a field we didn't flatten" requests.
3. **Natural key = `(ticker, date)`** with a UNIQUE constraint. Upsert target for `ON CONFLICT DO UPDATE`.
4. **CSV upload, client-parsed.** Browser reads the file with `papaparse` (already installed — see `lib/trade-utils.ts:1`), parses into the normalized shape, POSTs JSON to the server. Server only validates + upserts. This matches the existing trade-import flow (parse client-side → POST JSON to `/api/trades/import`).
5. **"Sync Sheet" button placed in the Archive tab** (`components/trading/ArchiveTab.tsx`). Hidden file input, click → pick file → parse → POST → toast with summary counts. No other UI changes.
6. **No delete sync.** Rows removed from the sheet stay in the DB. Upsert adds new and updates existing; never deletes.
7. **Parser is lenient.** Logs warnings (does not hard-fail) for blank-ticker rows, invalid dates, duplicate `(ticker, date)` within one upload, `#DIV/0!` values. Returns the surviving rows.
8. **Agent wiring deferred.** This spec only gets data into the DB and exposes the sync button. Agent queries against `system_tickers` are a future task.

### Design notes

- `raw_json` is the safety net. If Codex or I misjudge which ticker-level fields should be flat, we can add a future migration that promotes a field out of `raw_json` without re-uploading.
- The sheet reuses the same header names ("Time", "Stop", "$ Risk") across stages of a single trigger attempt — the parser keys off **column position**, not header name. Positions are captured in a constant lookup (see Phase 3) so the mapping is explicit and reviewable.
- Data types: only `ticker_r`, `trigger_count`, `day1_gap_pct` are stored as numeric. Everything else is text or JSONB. Rationale: the sheet mixes formats (`$1,250`, `N/A`, `#DIV/0!`, blank) and the text-everything approach avoids cast failures; numeric casts happen at query time where needed.

---

### Phase 1 — DB migration

**File:** `drizzle/0022_system_tickers.sql`
**Action:** CREATE

**Step 1.1 — Create the migration file**

Contents:
```sql
CREATE TABLE "system_tickers" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"grade" text,
	"primary_agenda" text,
	"secondary_agenda" text,
	"setup_type" text,
	"outcome" text,
	"ticker_win_loss" text,
	"ticker_r" double precision,
	"trigger_count" integer,
	"day1_gap_pct" double precision,
	"attempts_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_json" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_tickers_ticker_date_unique" UNIQUE("ticker","date")
);
--> statement-breakpoint
CREATE INDEX "system_tickers_date_idx" ON "system_tickers" USING btree ("date");
--> statement-breakpoint
CREATE INDEX "system_tickers_ticker_idx" ON "system_tickers" USING btree ("ticker");
```

**Step 1.2 — Append journal entry**

Add to `drizzle/meta/_journal.json` `entries` array (after the last entry):
```json
{
  "idx": 22,
  "version": "7",
  "when": 1777000000000,
  "tag": "0022_system_tickers",
  "breakpoints": true
}
```
Replace `1777000000000` with the current epoch-ms at the moment you write the file (`Date.now()` or `date +%s%3N`).

**Acceptance:**
- [ ] File `drizzle/0022_system_tickers.sql` exists with the SQL above.
- [ ] `drizzle/meta/_journal.json` contains a new entry with `"tag": "0022_system_tickers"` and `"idx": 22`.

---

### Phase 2 — Drizzle schema

**File:** `lib/db/schema.ts`
**Action:** MODIFY (append new table definition)

**Step 2.1 — Append the `systemTickers` table at the end of the file**

Import additions at top of file: none needed — `pgTable`, `text`, `date`, `doublePrecision`, `integer`, `jsonb`, `timestamp`, `unique`, `index` are all already imported.

Append after `weeklyReviews` (end of file, around line 408):
```typescript
// Shared system-trades log from the team's Google Sheet — no userId, shared across all users
export const systemTickers = pgTable('system_tickers', {
  id: text('id').primaryKey(),
  ticker: text('ticker').notNull(),
  date: date('date').notNull(),
  grade: text('grade'),
  primaryAgenda: text('primary_agenda'),
  secondaryAgenda: text('secondary_agenda'),
  setupType: text('setup_type'),
  outcome: text('outcome'),
  tickerWinLoss: text('ticker_win_loss'),
  tickerR: doublePrecision('ticker_r'),
  triggerCount: integer('trigger_count'),
  day1GapPct: doublePrecision('day1_gap_pct'),
  attemptsJson: jsonb('attempts_json').notNull().default([]),
  rawJson: jsonb('raw_json').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('system_tickers_ticker_date_unique').on(table.ticker, table.date),
  index('system_tickers_date_idx').on(table.date),
  index('system_tickers_ticker_idx').on(table.ticker),
]);
```

**Acceptance:**
- [ ] `systemTickers` is exported from `lib/db/schema.ts`.
- [ ] `npx tsc --noEmit` passes.

---

### Phase 3 — Parser

**File:** `lib/system-sheet-parser.ts`
**Action:** CREATE

**Step 3.1 — Types and helpers**

Create the file with this content:
```typescript
import Papa from 'papaparse';

export interface SystemStage {
  [field: string]: string | number | null;
}

export interface SystemAttempt {
  attemptIndex: number;
  triggerType: string | null;
  starter: SystemStage;
  fmTrig: SystemStage;
  fmTrigSub30: SystemStage;
  popVwap: SystemStage;
  fmCloseSubPiv: SystemStage;
  exit: SystemStage;
}

export interface ParsedSystemRow {
  ticker: string;
  date: string;              // ISO yyyy-MM-dd
  grade: string | null;
  primaryAgenda: string | null;
  secondaryAgenda: string | null;
  setupType: string | null;
  outcome: string | null;
  tickerWinLoss: string | null;
  tickerR: number | null;
  triggerCount: number | null;
  day1GapPct: number | null;
  attempts: SystemAttempt[];
  rawJson: Record<string, string | null>;
}

export interface ParsedSystemSheet {
  rows: ParsedSystemRow[];
  warnings: string[];
}

// Column positions (0-indexed) from "Agenda Database V3 - MAXIMILLION".
// Ticker-level block: cols 0..26.
// Trigger-attempt block: cols 27..72 (46 cols), repeated 4 times for attempts 1..4.
const TICKER_LEVEL_COLS = 27;
const ATTEMPT_BLOCK_WIDTH = 46;

// Field offsets inside one attempt block (0..45, relative to attempt start).
// Keys match SystemAttempt stage-field names. Values are column offsets within the block.
const ATTEMPT_SCHEMA = {
  starter: {
    riskDollars: 0,   // "Starter $ Risk"
    time: 1,
    highestRetrace: 2,
    stop: 3,
    twoMPiv: 4,       // "2M Piv"
    avg: 5,
    pos: 6,
    riskFinal: 7,     // "$ Risk"
  },
  fmTrig: {
    triggerType: 8,   // "Trigger Type"
    time: 9,
    highestRetrace: 10,
    stop: 11,
    price: 12,        // "5M Trig"
    addedShares: 13,
    newAvg: 14,
    newPos: 15,
    risk: 16,         // "$ Risk"
  },
  fmTrigSub30: {
    time: 17,
    highestRetrace: 18,
    stop: 19,
    price: 20,        // "5M Trig Sub 30%"
    addedShares: 21,
    newAvg: 22,
    newPos: 23,
    risk: 24,
  },
  popVwap: {
    time: 25,
    highestRetrace: 26,
    stop: 27,
    price: 28,        // "Pop Back To VWAP"
    addedShares: 29,
    newAvg: 30,
    newPos: 31,
    risk: 32,
  },
  fmCloseSubPiv: {
    time: 33,
    highestRetrace: 34,
    stop: 35,
    price: 36,        // "5M Close Sub Piv"
    addedShares: 37,
    newAvg: 38,
    newPos: 39,
  },
  exit: {
    avgWhenExit: 40,
    posWhenExit: 41,
    exitPrice: 42,
    pnl: 43,
    r: 44,
    wl: 45,
  },
} as const;

function cleanCell(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '#DIV/0!' || trimmed === '#N/A' || trimmed === '#REF!') {
    return null;
  }
  return trimmed;
}

function toNumber(raw: string | undefined | null): number | null {
  const cleaned = cleanCell(raw);
  if (cleaned == null) return null;
  // Strip $, commas, and trailing % (callers that want a percent value already get it as-is, e.g. "23.5%" → 23.5).
  const stripped = cleaned.replace(/[$,%]/g, '').replace(/\s/g, '');
  if (stripped === '' || stripped === '-') return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(raw: string | undefined | null): string | null {
  const cleaned = cleanCell(raw);
  if (cleaned == null) return null;

  // ISO already: "2026-04-23" or loose "2026-4-23"
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // US-style: "4/23/2026" or "4/23/26"
  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const [, m, d, yRaw] = usMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

function extractStage(
  row: string[],
  attemptBase: number,
  schema: Record<string, number>,
  numericFields: string[],
): SystemStage {
  const stage: SystemStage = {};
  for (const [field, offset] of Object.entries(schema)) {
    const cell = row[attemptBase + offset];
    if (numericFields.includes(field)) {
      stage[field] = toNumber(cell);
    } else {
      stage[field] = cleanCell(cell);
    }
  }
  return stage;
}

function hasAnyValue(stage: SystemStage): boolean {
  return Object.values(stage).some((value) => value !== null && value !== '');
}

export function parseSystemSheet(csvText: string): ParsedSystemSheet {
  const warnings: string[] = [];
  const rows: ParsedSystemRow[] = [];
  const seenKeys = new Set<string>();

  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      warnings.push(`CSV parse: row ${error.row ?? '?'} — ${error.message}`);
    }
  }

  const data = parsed.data;
  if (data.length < 2) {
    warnings.push('CSV has no data rows (expected a header row + at least one data row).');
    return { rows, warnings };
  }

  const header = data[0];
  // Sanity-check: expected header at col 2 = "Ticker", col 3 = "Day 1 Date".
  if (header[2]?.trim() !== 'Ticker' || header[3]?.trim() !== 'Day 1 Date') {
    warnings.push(`Unexpected header layout — col 2 should be "Ticker" and col 3 should be "Day 1 Date". Got "${header[2]}" / "${header[3]}".`);
  }

  for (let i = 1; i < data.length; i += 1) {
    const row = data[i];
    const rowNum = i + 1; // 1-indexed to match spreadsheet row numbers

    const ticker = cleanCell(row[2])?.toUpperCase() ?? null;
    if (!ticker) {
      // Blank/template row — skip silently.
      continue;
    }

    const isoDate = toIsoDate(row[3]);
    if (!isoDate) {
      warnings.push(`Row ${rowNum} (${ticker}): invalid or missing Day 1 Date "${row[3] ?? ''}" — skipped.`);
      continue;
    }

    const key = `${ticker}|${isoDate}`;
    if (seenKeys.has(key)) {
      warnings.push(`Row ${rowNum} (${ticker}, ${isoDate}): duplicate (ticker, date) within this upload — skipped.`);
      continue;
    }
    seenKeys.add(key);

    const attempts: SystemAttempt[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const base = TICKER_LEVEL_COLS + attempt * ATTEMPT_BLOCK_WIDTH;

      const starter = extractStage(row, base, ATTEMPT_SCHEMA.starter, ['riskDollars', 'stop', 'twoMPiv', 'avg', 'pos', 'riskFinal']);
      const fmTrig = extractStage(row, base, ATTEMPT_SCHEMA.fmTrig, ['stop', 'price', 'addedShares', 'newAvg', 'newPos', 'risk']);
      const fmTrigSub30 = extractStage(row, base, ATTEMPT_SCHEMA.fmTrigSub30, ['stop', 'price', 'addedShares', 'newAvg', 'newPos', 'risk']);
      const popVwap = extractStage(row, base, ATTEMPT_SCHEMA.popVwap, ['stop', 'price', 'addedShares', 'newAvg', 'newPos', 'risk']);
      const fmCloseSubPiv = extractStage(row, base, ATTEMPT_SCHEMA.fmCloseSubPiv, ['stop', 'price', 'addedShares', 'newAvg', 'newPos']);
      const exit = extractStage(row, base, ATTEMPT_SCHEMA.exit, ['avgWhenExit', 'posWhenExit', 'exitPrice', 'pnl', 'r']);

      if (!hasAnyValue(starter) && !hasAnyValue(fmTrig) && !hasAnyValue(exit)) {
        // Empty attempt slot — skip, don't push.
        continue;
      }

      attempts.push({
        attemptIndex: attempt + 1,
        triggerType: typeof fmTrig.triggerType === 'string' ? fmTrig.triggerType : null,
        starter,
        fmTrig,
        fmTrigSub30,
        popVwap,
        fmCloseSubPiv,
        exit,
      });
    }

    const rawJson: Record<string, string | null> = {};
    for (let col = 0; col < row.length; col += 1) {
      const headerName = header[col]?.trim() || `col_${col}`;
      const key = col < header.length ? headerName : `col_${col}`;
      // If header is duplicated (it is — "Time", "Stop", etc.), disambiguate by column index.
      const stored = rawJson[key] !== undefined ? `${key}__${col}` : key;
      rawJson[stored] = cleanCell(row[col]);
    }

    rows.push({
      ticker,
      date: isoDate,
      grade: cleanCell(row[5]),
      primaryAgenda: cleanCell(row[6]),
      secondaryAgenda: cleanCell(row[7]),
      setupType: cleanCell(row[15]),
      outcome: cleanCell(row[10]),
      tickerWinLoss: cleanCell(row[26]),
      tickerR: toNumber(row[22]),
      triggerCount: (() => {
        const n = toNumber(row[23]);
        return n == null ? null : Math.trunc(n);
      })(),
      day1GapPct: toNumber(row[12]),
      attempts,
      rawJson,
    });
  }

  return { rows, warnings };
}
```

**Acceptance:**
- [ ] `parseSystemSheet(csvText)` returns `{ rows, warnings }`.
- [ ] Rows with blank `Ticker` (col 2) are silently skipped (no warning).
- [ ] Rows with valid ticker but missing/invalid date produce a warning and are skipped.
- [ ] Duplicate `(ticker, date)` within one upload produces a warning and only the first row is kept.
- [ ] `#DIV/0!`, `#N/A`, `#REF!`, and empty strings become `null`.
- [ ] `$1,250` becomes numeric `1250`, `23.5%` becomes numeric `23.5`.
- [ ] Attempt slots with no values in starter/fmTrig/exit are omitted from the `attempts` array.
- [ ] `rawJson` preserves every non-null cell keyed by header name, with duplicate headers disambiguated by `__colIndex` suffix.

---

### Phase 4 — API validation schema

**File:** `lib/validations/system-sheet.ts`
**Action:** CREATE

**Step 4.1 — Zod schema for the sync POST body**

```typescript
import { z } from 'zod';

const stageSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

const attemptSchema = z.object({
  attemptIndex: z.number().int().min(1).max(4),
  triggerType: z.string().nullable(),
  starter: stageSchema,
  fmTrig: stageSchema,
  fmTrigSub30: stageSchema,
  popVwap: stageSchema,
  fmCloseSubPiv: stageSchema,
  exit: stageSchema,
});

export const systemSheetRowSchema = z.object({
  ticker: z.string().trim().min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO yyyy-MM-dd'),
  grade: z.string().nullable(),
  primaryAgenda: z.string().nullable(),
  secondaryAgenda: z.string().nullable(),
  setupType: z.string().nullable(),
  outcome: z.string().nullable(),
  tickerWinLoss: z.string().nullable(),
  tickerR: z.number().nullable(),
  triggerCount: z.number().int().nullable(),
  day1GapPct: z.number().nullable(),
  attempts: z.array(attemptSchema).max(4),
  rawJson: z.record(z.string(), z.union([z.string(), z.null()])),
});

export const systemSheetSyncBodySchema = z.object({
  rows: z.array(systemSheetRowSchema).min(1).max(5000),
});

export type SystemSheetSyncBody = z.infer<typeof systemSheetSyncBodySchema>;
export type SystemSheetRow = z.infer<typeof systemSheetRowSchema>;
```

**Acceptance:**
- [ ] `systemSheetSyncBodySchema` exported.
- [ ] Validates: date format, attempts length ≤ 4, row count 1..5000.

---

### Phase 5 — API route

**File:** `app/api/system-sheet/sync/route.ts`
**Action:** CREATE

**Step 5.1 — POST handler**

```typescript
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { systemTickers } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { systemSheetSyncBodySchema } from '@/lib/validations/system-sheet';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, systemSheetSyncBodySchema);
    if (bodyState.error) return bodyState.error;
    const { rows } = bodyState.data;

    let inserted = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const row of rows) {
        const result = await tx.insert(systemTickers).values({
          id: randomUUID(),
          ticker: row.ticker.toUpperCase(),
          date: row.date,
          grade: row.grade,
          primaryAgenda: row.primaryAgenda,
          secondaryAgenda: row.secondaryAgenda,
          setupType: row.setupType,
          outcome: row.outcome,
          tickerWinLoss: row.tickerWinLoss,
          tickerR: row.tickerR,
          triggerCount: row.triggerCount,
          day1GapPct: row.day1GapPct,
          attemptsJson: row.attempts,
          rawJson: row.rawJson,
        }).onConflictDoUpdate({
          target: [systemTickers.ticker, systemTickers.date],
          set: {
            grade: row.grade,
            primaryAgenda: row.primaryAgenda,
            secondaryAgenda: row.secondaryAgenda,
            setupType: row.setupType,
            outcome: row.outcome,
            tickerWinLoss: row.tickerWinLoss,
            tickerR: row.tickerR,
            triggerCount: row.triggerCount,
            day1GapPct: row.day1GapPct,
            attemptsJson: row.attempts,
            rawJson: row.rawJson,
            updatedAt: sql`now()`,
          },
        }).returning({
          id: systemTickers.id,
          importedAt: systemTickers.importedAt,
          updatedAt: systemTickers.updatedAt,
        });

        const saved = result[0];
        if (!saved) continue;
        // If importedAt === updatedAt (within a millisecond tolerance), this was a fresh insert.
        // Otherwise the row existed and we updated it.
        const importedMs = saved.importedAt?.getTime() ?? 0;
        const updatedMs = saved.updatedAt?.getTime() ?? 0;
        if (Math.abs(updatedMs - importedMs) < 5) inserted += 1;
        else updated += 1;
      }
    });

    return Response.json({
      inserted,
      updated,
      total: rows.length,
    });
  } catch (error) {
    logRouteError('system-sheet.sync.post', error);
    return Response.json({ error: 'Sync failed' }, { status: 500 });
  }
}
```

**Acceptance:**
- [ ] Route auth'd via `requireUser()` (any logged-in user can sync; data is shared).
- [ ] Input validated via `parseAndValidate(request, systemSheetSyncBodySchema)`.
- [ ] Upsert targets `(ticker, date)` and updates every column on conflict.
- [ ] Response JSON has `inserted`, `updated`, `total`.
- [ ] Route file at `app/api/system-sheet/sync/route.ts`.

---

### Phase 6 — UI button in Archive tab

**File:** `components/trading/ArchiveTab.tsx`
**Action:** MODIFY

**Step 6.1 — Add state, file input ref, and handler**

At the top of the `ArchiveTab` component (after the existing `useState` declarations around line 61), add:
```typescript
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
```

Add `useRef` to the imports at line 3:
```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
```

Add a handler function just above the `return` (around line 152):
```typescript
  const handleSyncSheetFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // Reset so picking the same file twice in a row still fires onChange.
    if (!file) return;

    setSyncing(true);
    setSyncStatus('Parsing sheet…');

    try {
      const text = await file.text();
      const { parseSystemSheet } = await import('@/lib/system-sheet-parser');
      const { rows, warnings } = parseSystemSheet(text);

      if (rows.length === 0) {
        setSyncStatus(`No rows parsed. ${warnings.length} warning(s).`);
        return;
      }

      setSyncStatus(`Uploading ${rows.length} row(s)…`);
      const response = await fetch('/api/system-sheet/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error ?? `Sync failed with status ${response.status}`);
      }

      const result = (await response.json()) as { inserted: number; updated: number; total: number };
      const skipped = warnings.length;
      const skippedSuffix = skipped > 0 ? `, ${skipped} skipped` : '';
      setSyncStatus(`Synced: ${result.inserted} new, ${result.updated} updated${skippedSuffix}.`);

      if (warnings.length > 0) {
        console.warn('System sheet sync warnings:', warnings);
      }
    } catch (error) {
      console.error('System sheet sync failed', error);
      setSyncStatus(`Sync failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };
```

**Step 6.2 — Add the button and hidden input to the filter row**

In the JSX at the filter row (around line 161, inside the existing `<div className="flex flex-wrap items-center gap-4">`), append after the date range `<div>` (just before its closing `</div>` at line 189):

```tsx
        <div className="ml-auto flex items-center gap-3">
          {syncStatus ? (
            <span className="text-xs text-zinc-500">{syncStatus}</span>
          ) : null}
          <button
            type="button"
            disabled={syncing}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync Sheet'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleSyncSheetFile}
            className="hidden"
          />
        </div>
```

**Acceptance:**
- [ ] Button labeled "Sync Sheet" renders on the Archive tab.
- [ ] Clicking it opens a file picker filtered to `.csv`.
- [ ] After upload, a status message shows `"Synced: N new, M updated"` (and `, K skipped` when warnings exist).
- [ ] While syncing, the button shows `"Syncing…"` and is disabled.
- [ ] No other part of the Archive tab (review list, filters, sheets) is changed.

---

### Phase 7 — Tests

#### 7a — Parser unit tests

**File:** `__tests__/system-sheet-parser.test.ts`
**Action:** CREATE

```typescript
import { describe, expect, it } from 'vitest';
import { parseSystemSheet } from '@/lib/system-sheet-parser';

// Build a minimal CSV with the 211-column structure. Header row + N data rows.
function makeCsv(headerOverrides: Partial<Record<number, string>>, dataRows: Array<Partial<Record<number, string>>>) {
  const totalCols = 211;
  const header = Array.from({ length: totalCols }, (_, i) => headerOverrides[i] ?? `col_${i}`);
  header[2] = 'Ticker';
  header[3] = 'Day 1 Date';
  const lines = [header.join(',')];
  for (const row of dataRows) {
    const cells = Array.from({ length: totalCols }, (_, i) => row[i] ?? '');
    lines.push(cells.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','));
  }
  return lines.join('\n');
}

describe('parseSystemSheet', () => {
  it('skips rows with blank ticker silently', () => {
    const csv = makeCsv({}, [
      { 2: '', 3: '2026-04-23' },
      { 2: 'AUUD', 3: '2026-04-23' },
    ]);
    const { rows, warnings } = parseSystemSheet(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe('AUUD');
    expect(warnings.filter((w) => w.includes('blank'))).toHaveLength(0);
  });

  it('warns and skips rows with invalid date', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: 'not-a-date' },
    ]);
    const { rows, warnings } = parseSystemSheet(csv);
    expect(rows).toHaveLength(0);
    expect(warnings.some((w) => w.includes('AUUD') && w.includes('invalid'))).toBe(true);
  });

  it('warns on duplicate (ticker, date) within one upload', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23' },
      { 2: 'AUUD', 3: '2026-04-23' },
    ]);
    const { rows, warnings } = parseSystemSheet(csv);
    expect(rows).toHaveLength(1);
    expect(warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('normalizes #DIV/0!, $, and % values', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23', 12: '23.5%', 22: '$1,250', 23: '3' },
    ]);
    const { rows } = parseSystemSheet(csv);
    expect(rows[0].day1GapPct).toBe(23.5);
    expect(rows[0].tickerR).toBe(1250);
    expect(rows[0].triggerCount).toBe(3);

    const csv2 = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23', 12: '#DIV/0!', 22: '', 23: '#N/A' },
    ]);
    const { rows: rows2 } = parseSystemSheet(csv2);
    expect(rows2[0].day1GapPct).toBeNull();
    expect(rows2[0].tickerR).toBeNull();
    expect(rows2[0].triggerCount).toBeNull();
  });

  it('accepts ISO and US date formats', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23' },
      { 2: 'SPRC', 3: '4/23/2026' },
      { 2: 'AGPU', 3: '2026-4-5' },
    ]);
    const { rows } = parseSystemSheet(csv);
    expect(rows.map((r) => r.date)).toEqual(['2026-04-23', '2026-04-23', '2026-04-05']);
  });

  it('builds attempts array and omits empty attempt slots', () => {
    // attempt 1 cols start at 27; starter $risk at offset 0 → col 27.
    // Populate attempt 1 only. Leave attempts 2-4 blank.
    const csv = makeCsv({}, [
      {
        2: 'AUUD',
        3: '2026-04-23',
        27: '$100',         // starter.riskDollars
        28: '9:31',         // starter.time
        35: 'Big Trig',     // fmTrig.triggerType (col 27 + 8 = 35)
        69: '1.5',          // exit.r (col 27 + 44 = 71) — wait, 27 + 44 = 71, not 69. see below.
      },
    ]);
    const { rows } = parseSystemSheet(csv);
    expect(rows[0].attempts).toHaveLength(1);
    expect(rows[0].attempts[0].attemptIndex).toBe(1);
    expect(rows[0].attempts[0].starter.riskDollars).toBe(100);
    expect(rows[0].attempts[0].starter.time).toBe('9:31');
    expect(rows[0].attempts[0].triggerType).toBe('Big Trig');
  });

  it('preserves full row in rawJson keyed by header names', () => {
    const csv = makeCsv(
      { 5: 'Grade' },
      [{ 2: 'AUUD', 3: '2026-04-23', 5: 'A+' }],
    );
    const { rows } = parseSystemSheet(csv);
    expect(rows[0].rawJson.Grade).toBe('A+');
  });
});
```

> Note on the `rows[0].attempts[0]` test: the fmTrig block starts at column `27 + 8 = 35` (starter is cols 27..34, fmTrig starts at 35 and "Trigger Type" is offset 8 within fmTrig — actually "Trigger Type" is the first fmTrig column so offset 8 relative to the attempt start). Before running, verify offsets against `ATTEMPT_SCHEMA` in `lib/system-sheet-parser.ts` and adjust test cell positions if any are off by one. The intent of each assertion is correct; only the exact column-index cell positions may need a small tweak.

#### 7b — Route integration test

**File:** `__tests__/system-sheet-sync-route.test.ts`
**Action:** CREATE

Follow the same mocking style as `__tests__/trades-route.test.ts` (it already mocks `getPoolDb`, `requireUser`, `ensureUser`). Assert:

1. `POST /api/system-sheet/sync` returns 401 when `requireUser` returns an error.
2. Returns 400 when body fails Zod validation (e.g. empty `rows` array, bad date format).
3. On a fresh row, `inserted` increments and `updated` stays at 0.
4. On a second call with the same `(ticker, date)`, `inserted` stays at 0 and `updated` increments by 1.
5. The upsert targets `(ticker, date)` — verify the mocked `onConflictDoUpdate` is called with `target: [systemTickers.ticker, systemTickers.date]`.

Use the existing route-test patterns — don't invent new mocking infrastructure.

**Acceptance:**
- [ ] Both test files exist and pass.
- [ ] Parser tests cover: blank-ticker skip, invalid-date warn+skip, duplicate-within-upload warn+skip, numeric cleaning, date format handling, attempts array, rawJson preservation.
- [ ] Route test covers: auth rejection, Zod rejection, insert path, update path.

---

### Phase 8 — Validation

From repo root `/home/jared/Nexus-Terminal`, run in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

Skip `npm run typecheck:services` — nothing under `services/` is touched. Skip `npm run workflow:audit` — no workflow assets are changed.

Expected test count delta: `+2` files (parser tests, route tests), `+~12` tests. Update the Validation Snapshot at the top of this file with the new counts.

**Manual sanity check (after deploy):**
1. Navigate to the Archive tab.
2. Click "Sync Sheet", pick `Agenda Database V3 - MAXIMILLION (1).csv` from `/mnt/c/Users/jared/Downloads/`.
3. Confirm status message shows `"Synced: N new, 0 updated"` on first run (N should roughly equal the number of real data rows in the sheet — blank template rows at the top of the sheet should be skipped).
4. Click "Sync Sheet" again with the same file. Confirm the message changes to `"Synced: 0 new, N updated"`.
5. In the DB (via `npm run db:studio` or a direct query): confirm `SELECT COUNT(*) FROM system_tickers` matches N, and pick one row to confirm `attempts_json` and `raw_json` look sensible.

---

### Files Changed Summary

| File | Action | Approx. lines | Risk |
|---|---|---|---|
| `drizzle/0022_system_tickers.sql` | CREATE | ~20 | LOW |
| `drizzle/meta/_journal.json` | MODIFY | +7 (1 entry) | LOW |
| `lib/db/schema.ts` | MODIFY | +22 (1 table) | LOW |
| `lib/system-sheet-parser.ts` | CREATE | ~220 | MEDIUM |
| `lib/validations/system-sheet.ts` | CREATE | ~30 | LOW |
| `app/api/system-sheet/sync/route.ts` | CREATE | ~80 | LOW |
| `components/trading/ArchiveTab.tsx` | MODIFY | +55 (state + handler + button) | LOW |
| `__tests__/system-sheet-parser.test.ts` | CREATE | ~120 | LOW |
| `__tests__/system-sheet-sync-route.test.ts` | CREATE | ~100 | LOW |

Parser is marked MEDIUM because column-offset arithmetic is the only place a bug can hide — everything else is boilerplate. The tests in 7a are the backstop.

---

### Files NOT to touch

- `lib/db/schema.ts` — other tables. Only append `systemTickers`.
- `app/page.tsx` — tab wiring is unchanged.
- `lib/csv-parser.ts` / `lib/trade-utils.ts` — trade-import CSV parser is unrelated; don't share code with the system-sheet parser (different shape entirely).
- `.env*` files.

---

### Open Questions for Codex

None — the plan is locked. If a column offset in `ATTEMPT_SCHEMA` doesn't match reality when you run the parser against the sample CSV at `/mnt/c/Users/jared/Downloads/Agenda Database V3 - MAXIMILLION (1).csv`, fix the offset constant in-place and note it in the completion report — don't spin this off into a new spec.
