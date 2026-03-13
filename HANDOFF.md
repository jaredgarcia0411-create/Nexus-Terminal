# Nexus Terminal — HANDOFF.md

> Generated: 2026-03-13 | Agent: nexus-architect
> Status: READY FOR EXECUTION

## Codebase Audit — Cleanup & Hardening Sprint

This handoff contains 8 implementation tasks from a full codebase audit. All tasks are
low-complexity with no architectural changes. Execute in order — Task 1 (security) is highest priority.

---

## Task 1: Enforce ALLOWED_EMAILS in Auth (SECURITY — HIGH PRIORITY)

**Problem:** Any Google account can sign in. The `ALLOWED_EMAILS` env var is documented in `.env.example` but never checked.

**File:** `lib/auth-config.ts`

**Implementation:**

Add a `signIn` callback to the NextAuth config that rejects users not in the allowlist. When `ALLOWED_EMAILS` is empty or unset, allow all users (current behavior).

```typescript
// In the callbacks object, add signIn before authorized:
signIn({ user }) {
  const allowedRaw = process.env.ALLOWED_EMAILS?.trim();
  if (!allowedRaw) return true; // empty = allow all
  const allowed = allowedRaw.split(',').map(e => e.trim().toLowerCase());
  return allowed.includes(user.email?.toLowerCase() ?? '');
},
```

Insert this callback at `lib/auth-config.ts` inside the `callbacks` object (line 30), before the existing `authorized` callback.

**Verification:** `npx tsc --noEmit` passes. Manually test: set `ALLOWED_EMAILS=your@email.com` in `.env.local`, verify login works for that email. Set it to `other@email.com`, verify login is rejected.

---

## Task 2: Update CLAUDE.md to Match Codebase Reality

**Problem:** Multiple factual mismatches between CLAUDE.md and the actual codebase.

**File:** `.claude/CLAUDE.md`

**Changes required:**

### 2a. Fix table count and list
Replace the "Tables (11)" section with the actual 15 tables:

```
### Tables (15)
users, trades (composite PK: user_id + id), trade_executions, trade_tags, tags,
trade_import_batches, broker_sync_log, agent_memory, research_reports,
daily_ticker_summaries, saved_tickers, market_snapshots, macro_summaries,
jarvis_conversations, jarvis_request_log
```

### 2b. Update API routes section
Add these undocumented routes:

```
## Saved Tickers
- GET/POST/DELETE `/api/saved-tickers`

## Market Data
- GET `/api/market-data` (Massive API proxy)
- GET/POST `/api/market-data/daily-summary`
- GET `/api/market-data/snapshot`

## Jarvis AI
(add to existing section)
- GET `/api/jarvis/macro-summary/latest`
```

### 2c. Update Jarvis file paths
The flat `lib/jarvis-*.ts` files no longer exist. Replace the entire "Jarvis AI Pipeline" and "Jarvis Safety & Observability" sections with:

```
## Jarvis AI Pipeline (lib/jarvis/)
- lib/jarvis/client.ts — LLM wrapper with retry + circuit breaker
- lib/jarvis/types.ts — shared types (JarvisMode, JarvisRequest, JarvisResponse)
- lib/jarvis/prompts.ts — system/user prompt construction
- lib/jarvis/context.ts — conversation context assembly
- lib/jarvis/memory.ts — persistent user memory CRUD
- lib/jarvis/research.ts — research orchestration
- lib/jarvis/trade-analysis.ts — trade analysis pipeline
- lib/jarvis/askedgar.ts — AskEdgar API client
- lib/jarvis/scrape-lite.ts — lightweight web scraping
- lib/jarvis/rate-limit.ts — per-user rate limiting (30 req/hr)
- lib/jarvis/circuit-breaker.ts — LLM failure circuit breaker
- lib/jarvis/token-tracking.ts — per-request token/latency logging
- lib/jarvis/admin.ts — admin stats and memory management
```

### 2d. Remove dangling Sprint 8 spec reference
Replace `docs/SPRINT_8_SPEC.md` reference with just `docs/AE_API_DOCS.md` (the spec file doesn't exist).

### 2e. Remove the "Known Issues" item about ALLOWED_EMAILS
After Task 1 is complete, remove item 1 from Known Issues.

**Verification:** Read through the updated CLAUDE.md and spot-check file paths with `ls`.

---

## Task 3: Rename package.json

**Problem:** `package.json` name is `"ai-studio-applet"`, a leftover from the project's origin.

**Files:** `package.json`

**Change:** Line 2, replace `"ai-studio-applet"` with `"nexus-terminal"`.

**Do NOT** regenerate `package-lock.json` — just change the name field. The lock file will update on next `npm install`.

**Verification:** `npm run lint && npx tsc --noEmit`

---

## Task 4: Clean Up next.config.ts

**Problem:** Stale placeholder and naming references.

**File:** `next.config.ts`

**Changes:**

1. **Remove picsum.photos remote pattern** (lines 13-17). No code references this domain. Keep only the `lh3.googleusercontent.com` pattern (needed for Google profile photos).

2. **Update comment on line 31:** Change `"HMR is disabled in AI Studio via DISABLE_HMR env var."` to `"HMR can be disabled via DISABLE_HMR env var for agent workflows."`

**Verification:** `npm run build` still succeeds.

---

## Task 5: Delete Orphaned JarvisPanel Component

**Problem:** `components/trading/JarvisPanel.tsx` is never imported anywhere.

**Action:** Delete the file.

**Verification:** `grep -r "JarvisPanel" .` returns no results (excluding this HANDOFF.md). `npx tsc --noEmit` passes.

---

## Task 6: Rename BacktestingTab to JarvisTab

**Problem:** The "Backtesting" tab actually renders `<JarvisChat />`. There is no backtesting logic.

**Files to change:**

1. **`components/trading/BacktestingTab.tsx`** — Rename file to `JarvisTab.tsx`. Update the default export name from `BacktestingTab` to `JarvisTab`.

2. **`components/trading/Sidebar.tsx`** — In the `TabKey` type (line 10), replace `'backtesting'` with `'jarvis'`. Update the corresponding sidebar item's label from "Backtesting" to "Jarvis" and icon from `FlaskConical` to a chat/bot icon (e.g., keep `FlaskConical` or use `MessageSquare` from lucide-react — user preference).

3. **`app/page.tsx`** — Update the import from `BacktestingTab` to `JarvisTab`. Update the `activeTab === 'backtesting'` conditional to `activeTab === 'jarvis'`.

**Verification:** `npx tsc --noEmit` passes. Dev server renders the tab correctly.

---

## Task 7: Fix `any` Types (6 Locations)

**Problem:** Explicit `any` usages reduce type safety.

**Changes (fix the ones that are straightforward, skip if typing is genuinely impossible):**

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `lib/csv-parser.ts` | ~250 | `data: any[]` | `data: Record<string, string>[]` (papaparse returns string fields) |
| `components/trading/TradingCalendar.tsx` | ~68-69 | `any[]` for weeks | `(DayData \| null)[][]` or whatever the day type is in that file |
| `components/trading/CandlestickChart.tsx` | ~549 | `param: any` | `param: MouseEventParams` from `lightweight-charts` (import the type) |

**Skip these (acceptable):**
- `lib/db.ts:8` — internal legacy compat layer
- `lib/trading-utils.ts:22` — intentional coercion of unknown input
- `hooks/use-trades.ts:776` — non-standard DOM API (`webkitRelativePath`)

**Verification:** `npx tsc --noEmit` passes after each change.

---

## Execution Checklist

```
[x] Task 1: ALLOWED_EMAILS enforcement in lib/auth-config.ts
[x] Task 2: Update .claude/CLAUDE.md (tables, routes, Jarvis paths, Sprint 8 ref)
[x] Task 3: Rename package.json name to "nexus-terminal"
[x] Task 4: Clean next.config.ts (remove picsum.photos, update comment)
[x] Task 5: Delete components/trading/JarvisPanel.tsx
[x] Task 6: Rename BacktestingTab → JarvisTab (3 files)
[x] Task 7: Fix 3 `any` types (csv-parser, TradingCalendar, CandlestickChart)
```

**Post-execution:** Run `npm run lint && npx tsc --noEmit && npm run test` to verify nothing is broken.
