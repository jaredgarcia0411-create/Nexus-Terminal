# FUTURE-PLANS.md

Parked ideas and longer-horizon plans. Each entry should note **why it's parked** and what would unblock it.

---

## Recurring chores (not parked — just a checklist)

- **`docs/ARCHITECTURE.md` freshness** — review at the end of each sprint. Update only when structure changes meaningfully (new top-level concern, folder reorg, new agent surface, new convention). Skip if nothing structural shifted. Stale architecture docs are worse than no architecture docs.

---

## Embed AskEdgar via iframe (parked 2026-05-01)

### The idea
Coworker suggested embedding the AskEdgar website inside Nexus Terminal's research tab via an `<iframe>`. The premise was:
- Share **one** AskEdgar subscription across the team
- Reduce our own API/build work since users would interact with AE directly
- Potentially replace the entire research tab

### Why it's parked
**AskEdgar's Terms of Service explicitly forbid the shared-subscription premise.**

Direct quotes from https://www.askedgar.io/legal/terms:
- > "Your account may only be used by one person. A single account shared by multiple people is not permitted."
- > "Each person must set up a new account for themselves."
- "Sharing logins" is listed as a suspension trigger.
- No bulk-download / scraping / programmatic access permitted.
- No redistribution without a separate written business license.
- No team/multi-seat plan in the standard ToS.

Going ahead with the original idea would put the account at risk of suspension. Not worth it.

### Technical feasibility (in case the legal side changes)
Checked 2026-05-01:
- `app.askedgar.io` returns no `X-Frame-Options` header and no `Content-Security-Policy` header.
- No CSP `<meta>` tag in the HTML.
- **Headers say embedding is allowed.** This could change at any time without notice.

Untested caveats — would need to verify with a real embed:
- Third-party cookie blocking (Chrome/Safari) often breaks login persistence inside cross-origin iframes.
- Next.js middleware can apply CSP per-route, so deep authenticated routes might behave differently than the login page.
- Cross-origin policy means we can't read iframe content, sync state, pre-fill searches, or extract data — it would be a visual passthrough only.

### Options to revisit later

1. **Each user buys their own AE subscription**, Nexus embeds AE purely as a UX convenience.
   - ToS-compliant.
   - Cuts our dev work on the AE replacement.
   - Costs each coworker a subscription.
   - Doesn't reduce our API calls if the current AE integration is server-side — it shifts load to AE's infra.

2. **Contact AskEdgar about a business / team license.**
   - Their ToS specifically mentions a "separate written business license agreement" exists.
   - A negotiated team rate for a handful of seats is plausible.
   - Lowest-risk path to making the original idea legitimate.
   - **Cheapest first step:** send an email before doing any technical work.

3. **Drop the iframe idea entirely, keep building the AE replacement in-house.**
   - No legal risk, no per-seat cost.
   - Keeps full dev burden on us.

### Triggers to revisit
- AE adds a public team/multi-seat plan.
- We get a response from AE on a business license.
- Our in-house AE replacement stalls and we need a faster path.

### What to check before acting
- Re-test `app.askedgar.io` headers — they may have added `X-Frame-Options` or CSP `frame-ancestors` since this was written.
- Re-read the [ToS](https://www.askedgar.io/legal/terms) — clauses change.
- Confirm our existing `lib/askedgar.ts` integration is still ToS-compliant (cached helpers, not bulk download).

---

## Semantic-token migration pass (parked 2026-05-04)

### The idea
Replace hardcoded color literals in `.tsx` files (`bg-[#121214]`, `text-white`, `border-white/10`, etc.) with the semantic tokens already defined in `app/globals.css` (`bg-card`, `text-foreground`, `border-border`, etc.). Same visual output, but every color routes through one variable in `globals.css` instead of being splattered across ~50 files.

### Why it's worth doing on its own
- Fixes the recurring UI-inconsistency pain point — right now "the card background" is `#121214` in some files, `bg-zinc-900` in others, `bg-white/[0.02]` in a few more. Tokens give you one source of truth.
- shadcn/ui (already in use, see `components.json`) is built around these tokens — the trading-specific components just drifted into hex literals over time.
- Makes a future light-mode toggle a weekend job instead of a 1–2 day project (see "Why it's parked" below).

### Why it's parked
Bigger goal it unblocks (light/dark mode toggle) isn't a priority right now. The migration itself is mechanical but touches ~50 files, so we'd want to batch it as one focused pass rather than dribble it in.

### The mapping
| Hardcoded | Semantic token |
|---|---|
| `bg-[#0A0A0B]` | `bg-background` |
| `bg-[#121214]` | `bg-card` (or `bg-popover` for menus/dropdowns) |
| `bg-[#18181b]` | `bg-muted` |
| `text-white` | `text-foreground` |
| `text-zinc-400` / `text-zinc-500` | `text-muted-foreground` |
| `border-white/10` / `border-white/5` | `border-border` |
| `bg-white/5` | `bg-accent` (or `bg-input` for input fields) |
| `text-rose-500` (destructive actions) | `text-destructive` |

**Stays literal on purpose:** P&L greens/reds (`text-emerald-400`, `text-rose-400`) and chart-specific tints. Those are data viz, not UI chrome.

### Scope at time of writing (2026-05-04)
- `bg-[#…]` / `bg-zinc-*` / `bg-white/N` literals: **49 files**
- `text-white` / `text-zinc-*` literals: **49 files**
- `border-white/N` / `border-zinc-*` literals: **46 files**
- Out of **60** total `.tsx` files in `components/` + `app/`

### Execution plan
1. **Pilot a single file** (e.g. `components/trading/SettingsMenu.tsx`). Apply the mapping, run `npm run lint && npx tsc --noEmit`, eyeball the diff vs `main` — should be visually identical.
2. **Walk the file list.** Group by family (`Backtest*.tsx`, `Performance*.tsx`, `Research*.tsx`) so the context-switching is minimal.
3. **Skip charts in this pass.** `BacktestChart.tsx`, `CandlestickChart.tsx`, `ResearchChart.tsx`, `PerformanceCharts.tsx` pass colors as JS strings to chart libraries (lightweight-charts, recharts) — those don't accept Tailwind classes. They'd need a `getComputedStyle(...).getPropertyValue('--color-card')` pattern, which is a separate, smaller pass.
4. **Validate.** `npm run lint && npx tsc --noEmit && npm test`, then click through every tab/dialog/sheet — the goal is zero pixel diff.

### Best way to run it
Mechanical + explicit rules + easy to verify with `git diff` → ideal Codex spec. Hand Codex a `HANDOFF.md` containing the mapping table, the file list, and the "do not touch chart-init color strings" rule. Suggest piloting one file manually first to confirm the mapping looks right before fanning out.

### Triggers to revisit
- Want to add a light-mode toggle (this migration is the prerequisite).
- UI inconsistencies become painful enough to fix on their own merits.
- A larger UI redesign — would want tokens in place before changing the palette.

### What to check before acting
- Re-grep counts — files may have grown/shrunk since this was written.
- Confirm `app/globals.css` token names still match the table above.
- Decide whether to also collapse the chart-color JS strings in the same pass or defer.

---

## Broker sync (parked 2026-05-17)

### The idea
A "Connect Broker → Sync Trades" flow that pulls a user's executions directly from their brokerage instead of relying on CSV imports. Click a button, see your fills land in the journal.

### Why it's parked
Research-only. No active sprint. With ~5 users and CSV import working, there's no urgency. The point of this entry is to preserve the architecture decision so future-us doesn't redo the legwork. Revisit when onboarding friction or a real user complaint makes one-click sync worth a sprint.

### The decision
**Use SnapTrade as the primary aggregator, and leave room for direct broker integrations behind a common `BrokerSource` interface.**

Why both:
- SnapTrade covers ~30 brokers with one integration and public self-serve pricing ($2/user/mo). Right shape for v1.
- Some brokers we use (notably **Lightspeed Financial**) are not in SnapTrade's catalog — direct API is the only path.
- Direct integrations also win on data richness (e.g., Tastytrade's options-leg metadata) and per-broker cost at scale.
- Both paths funnel through one normalized trade shape, so the rest of the app doesn't care which source a trade came from.

### Aggregator landscape (researched 2026-05-17)

| Aggregator | Pricing | Verdict |
|---|---|---|
| **SnapTrade** | $2/user/mo, free dev tier (1 dev / 5 accounts), public self-serve | ✅ Right call |
| Plaid Investments | Sales-gated, ~$1k+/mo minimum, ≤2 yr history | ❌ Won't sign small platforms |
| Akoya | Enterprise sales, bank-heavy coverage | ❌ Wrong shape for retail brokers |
| MX | Enterprise sales, ~$15k/yr floor | ❌ Same |
| Yodlee / Finicity | Enterprise sales, brittle screen-scraping for brokerage | ❌ |

SnapTrade wins because: purpose-built for retail brokerage (not banks), longest history lookback (Schwab ~4yr), supports both read and trade, and you can prototype against the free tier in a day without a sales call.

### SnapTrade broker catalog (2026-05-17)
All listed brokers support read + trade.

- **US:** Alpaca, Chase, Coinbase, Empower, E*TRADE, Fidelity, Kraken, Public, Robinhood, Schwab, tastytrade, TradeStation, Tradier, Vanguard, Webull US
- **Canada:** Questrade, TD Direct Investing, Wealthsimple, Webull Canada
- **Europe/UK:** AJ Bell, BUX, DEGIRO, Trading 212
- **Australia:** Commsec, Stake AUS
- **Global:** Binance, eToro, Interactive Brokers, Moomoo
- **India:** Upstox

**Lightspeed Financial is not in SnapTrade's catalog.** Direct integration required.

### Direct broker API landscape (researched 2026-05-17)

| Broker | API status | Friction | Notes |
|---|---|---|---|
| **Tastytrade** | Public API, OAuth 2.0, official SDKs | Low | Best DX, anyone can register |
| **Alpaca** | API-first, instant signup | Low | Only useful for Alpaca account holders |
| **Schwab** | Official REST, OAuth 2.0 | Medium | Refresh token expires every 7 days — user re-auths weekly |
| **Webull** | Official API since 2024–25 | Medium | Small US user base |
| **E*TRADE** | OAuth 1.0a (legacy) | Medium | Each user needs own dev key tied to their account |
| **Interactive Brokers** | Web API w/ OAuth 2.0 (or local CP Gateway) | High | Heavy registration; requires Pro account |
| **Lightspeed Connect** | WebSocket, JSON | Unknown — see caveat | Launched Nov 2024, v2.0.4 Apr 2025, routes through IBKR infra |
| Fidelity | No public retail trading API | — | Aggregator or CSV only |
| Robinhood (equities) | Crypto-only public API; unofficial libs violate TOS | — | Aggregator or CSV only |
| M1, Public, SoFi | No public APIs | — | CSV only |

#### Lightspeed-specific caveat
Lightspeed Connect is built for **trading automation** (WebSocket fills as they happen), not necessarily **historical retrieval**. Before designing the integration, email `apitrading@lightspeed.com` and ask:
> "Can the Connect API return historical executions/fills (REST or otherwise) for a connected account, with timestamp/price/qty/fees per fill, for trade journaling purposes?"

If yes → direct integration fits cleanly under `BrokerSource`. If no → fallback to Lightspeed's CSV export (same dedup pipeline, manual upload UI).

### Architecture: the `BrokerSource` pattern
One interface, many providers behind it. Mirrors the existing CSV parser registry pattern (`lib/parsers/registry.ts`).

```ts
interface BrokerSource {
  provider: string;
  connect(userId): Promise<{ redirectUrl: string }>;
  handleCallback(params): Promise<BrokerConnection>;
  fetchTrades(conn, since): Promise<NormalizedTrade[]>;
  refreshAuth?(conn): Promise<BrokerConnection>;
}

const sourceRegistry = {
  snaptrade:  snapTradeSource,
  lightspeed: lightspeedSource,
  // future: tastytrade, alpaca, schwab, ...
};
```

The generic sync route:
```ts
// POST /api/broker/sync
const conn = await db.query.brokerConnections.findFirst({ ... });
const source = sourceRegistry[conn.provider];
const trades = await source.fetchTrades(conn, conn.lastSyncedAt);
// pipe into existing /api/trades/import with batchKey = `${conn.id}:${syncTs}`
```

The point: SnapTrade-specific quirks live inside `snapTradeSource.ts`. Lightspeed's WebSocket weirdness lives inside `lightspeedSource.ts`. The rest of the app sees `NormalizedTrade[]` and nothing else.

### How this fits the existing codebase
Nexus is unusually well-prepared:

- **`trades` + `tradeExecutions` schema** (`lib/db/schema.ts:16-67`) already models everything needed: price, qty, time, commission, fees per fill. No trade-data schema changes needed.
- **`/api/trades/import`** (`app/api/trades/import/route.ts:191-363`) already accepts batched trades with a `batchKey` for idempotency. Sync results flow through this exact route.
- **`tradeImportBatches`** (`lib/db/schema.ts:102-109`) gives "don't re-import the same sync" for free.
- **`brokerSyncLog`** (`lib/db/schema.ts:111-120`) is already defined but unused — ready to log each sync run.

**What's missing:**
1. A `broker_connections` table: `(id, userId, provider, status, connected_at, externalAccountId, credentialsEncrypted)`.
2. Routes: `POST /api/broker/connect`, `GET /api/broker/[provider]/callback`, `POST /api/broker/sync`, `GET /api/broker/sync/:id`.
3. Broker source clients in `lib/broker-sources/*` (one file per provider).
4. A `source` column on `trades`: `'manual' | 'csv' | 'broker:snaptrade:schwab' | 'broker:lightspeed' | ...`.
5. UI: connect-broker button + connection list + sync button + reauth banner when status flips to `'reauth_required'`.

### Implementation patterns
- **Connect flow:** server generates one-time URL → popup → callback validates `state` (CSRF) → store the aggregator's stable `connection_id` (or encrypted refresh token for direct). Never store broker passwords.
- **Sync flow:** button-triggered, not cron. Server enqueues, returns `sync_id`, frontend polls `GET /api/broker/sync/:id` every 2s. Use `export const maxDuration = 60`. (SSE via `lib/sse.ts` works but polling is simpler for v1.)
- **Dedup:** partial unique index on `(broker_connection_id, external_id)`. Every modern broker returns a stable execution ID. Fallback: `sha256(symbol|side|qty|price|filled_at_rounded_to_second)` as `dedup_hash`.
- **Manual-vs-synced collision:** if sync finds a trade matching a manual one (hash within ±5 min, same symbol/qty/side), show a "Merge?" prompt. **Never auto-merge** — users notice when data silently changes.
- **Backfill:** most brokers cap API history at ~90 days. Accept the cap. Keep CSV import as the "old history" path forever.

### Edge cases people miss
- **Token expiry:** catch 401 → flip `status='reauth_required'` → surface banner. Don't silently retry.
- **Partial fills:** each fill is its own row keyed on `execution_id`. Don't aggregate at import — let the UI roll up by `order_id`.
- **Corrections:** brokers send a `corrected` flag or a negative-qty counter-trade. Store both; sum at read time.
- **Corporate actions** (splits, dividends): ignore in v1. Log as `account_events` later if needed.
- **Multi-leg options:** group by `strategy_id` or `order_id`. Each leg is still its own row.
- **Currency:** store `currency` per trade + `fx_rate_to_usd` at fill time. Convert in the read query, not on write.
- **Disconnect ≠ delete:** keep trade history, null out `broker_connection_id`, flip source to `'broker:disconnected:<name>'`.

### Security bar
For a hobbyist platform with <50 known users:
- Use SnapTrade — never store broker credentials yourself, sidesteps ~80% of compliance surface.
- For direct integrations where you must store tokens: `pgcrypto`'s `pgp_sym_encrypt` with a key from env (`BROKER_TOKEN_KEY`). Never log tokens.
- Read-only broker scopes only. Don't request trading permissions you won't use.
- No SOC 2 / KMS / vault rotation needed at this scale.

### Recommended first slice when this is unparked
1. Sign up for SnapTrade's free tier (1 dev / 5 accounts) and prototype the connect flow against their sandbox. Half-day of poking — tells you the actual shape of their trade-fill response, which determines the `NormalizedTrade` schema.
2. **In parallel:** email `apitrading@lightspeed.com` with the "can you return historical fills" question.
3. Build the `BrokerSource` interface + `snapTradeSource` first. Use `provider: 'snaptrade'` from day one even though it's the only provider — bakes in the abstraction so the second provider isn't a rewrite.
4. Ship `/api/broker/connect` + `/api/broker/sync` + UI end-to-end with one broker (e.g., Schwab via SnapTrade).
5. Iterate: add direct Lightspeed if Connect supports historical fills, otherwise add CSV-import polish as the Lightspeed path.

### Triggers to revisit
- A user complains about CSV import friction or asks for one-click sync.
- A broker we use gets added to SnapTrade (or removed — they update the catalog).
- Lightspeed confirms historical API support (or doesn't, locking in the CSV-fallback path).
- We onboard non-coworker users — "one-click sync" becomes a real onboarding lever.

### What to check before acting
- Re-fetch [SnapTrade's broker catalog](https://snaptrade.com/brokerage-integrations) — brokers come and go.
- Re-check [SnapTrade pricing](https://snaptrade.com/pricing) — startup pricing changes.
- Confirm `brokerSyncLog` still exists at `lib/db/schema.ts:111-120` and matches what we'd want.
- Confirm `/api/trades/import` still accepts a `batchKey` for idempotency.
- Verify Lightspeed Connect's historical-fill capability before designing around it.

---

## Share Issuance Restrictions in Research Reports (parked 2026-05-20)

### The idea
Add a "Share Issuance Restrictions" section to the small-cap research report that summarizes any lock-up, standstill, variable-rate-transaction prohibitions, or similar restrictions on subsequent equity issuances disclosed in SEC filings over the last 12 months. Output is a numbered list ordered newest-to-oldest with dates, durations, and exceptions — e.g.:

> 1. Date: 1/13/2026
>    Company is restricted from issuing common stock for 45 days following the closing date.
>    Exceptions: Issuances under stock/option plans up to $50k per quarter, and securities for acquisitions approved by disinterested directors.

The saved prompt (kept for reference): *"in short and simple terms, list out, in numbered list any restrictions on subsequent equity issuances that appear in the context, make sure to include dates and timelines, if applicable, regarding how long the restriction is or when it ends … And also indicate if there are exceptions. If there is no info on share issuance restrictions then say that there's no info on share issuance restrictions. (ONLY FOCUS ON DEVELOPMENTS IN THE LAST 12 MONTHS)"*

### Why it's parked
Approach not yet locked in. Need to decide between three implementation paths (below) before writing the spec. Also not blocking anything urgent — the existing research report already captures dilution risk via offerings/registrations/dilution rating.

Inspired by Perplexity Finance's "Insights" feature (saved custom prompts per ticker), but scoped down to just this one prompt — building a full Insights feature for a single saved prompt would be overengineering for current needs.

### Critical context — what the LLM actually sees today
This is what made the original "just add a prompt line" idea not work, so it must be documented:

- The research-report LLM call (`lib/agents/blueprints/small-cap-research.ts:736`) receives **structured fields**, not filing bodies.
- `offerings` (`lib/sec/offerings.ts`) does read full filing text via `getFilingBody`, but the regex extractors anchor on **amount/price** language and only return a ~600-char `sourceSnippet` around the *offering match* — not around any lock-up/standstill language.
- `news` items are truncated to a **280-char summary** (`MAX_SUMMARY_LENGTH` in `lib/agents/news-formatter.ts:38`).
- **No raw 8-K, 424B, S-1, or exhibit body text** enters the prompt today.
- Ask Edgar has **no clean field for restriction language**:
  - `/v1/offerings` and `/v1/registrations` return amounts/dates/types only.
  - `/v1/agreements` is the closest (per `docs/ae-buildout.md:140`, covers "registration rights, ROFR, participation rights, tail fees, restrictions, price protection") but is described as extraction-heavy, has been dropped from the `small-cap-research` scope, and isn't in `ENDPOINT_SCOPES` today.
  - `dilution-rating.mgmt_commentary` sometimes mentions restrictions but is editorial — not structured.

So the data simply isn't in the prompt — we'd need to extract it from filing bodies ourselves and feed it in.

### Three implementation paths

#### A.1 — Targeted restrictions parser (cleanest, most work)
Build a new `lib/sec/share-issuance-restrictions.ts` modeled on `lib/sec/identity-events.ts` and `lib/sec/offerings.ts`.

- Pull filings from `getSecFilingsForProfile` for forms `424B*`, `8-K` (Items 1.01, 2.03, 3.02), `S-1/F-1`, `S-3/F-3` over the last 365 days.
- Use `getFilingBody` (already SEC-cached in the `sec_filing_body_cache` table) to read the body.
- Regex-scan for restriction phrases: `lock-up period`, `standstill`, `shall not issue`, `agreed not to offer.{0,40}common stock`, `restricted from issuing`, `variable rate transaction`, `prohibited from entering into`, etc.
- Return structured rows: `{ effectiveDate, durationDays, description, exceptions, formType, url, sourceSnippet, confidence }`.
- Add a `'share-issuance-restrictions'` key to `ENDPOINT_REGISTRY` (`lib/askedgar/endpoints.ts`), include in `small-cap-research` scope, render it as a new section in the prompt.
- LLM job becomes a thin formatting step over structured data.

**Pros:** structured, cacheable, free (no Ask Edgar billing — same pattern as `offerings`/`reverse-splits`), reusable elsewhere (dilution panel, scanner). Matches existing parser patterns.
**Cons:** ~300–500 lines of new parser code + regex tuning over real filings. This is the bulk of the effort.

#### A.2 — Raw filing body injection (laziest, expensive)
- For the last 12 months of `424B*` and `8-K` Item 1.01 filings, slice the body around "Lock-Up" / "Restrictions on Future Sales" / "Standstill" headings and dump the text into the prompt.
- Let the LLM do all the parsing and formatting.

**Pros:** ~80 lines of code — pick the filings, grep section headings, paste.
**Cons:** token cost balloons (a 424B "Lock-Up" section is often 5–20KB; 5–10 filings per ticker → 50–200KB added per report). Latency rises. Lower reliability — model handles both extraction and formatting with nothing to validate against.

#### A.3 — Extend the existing offerings parser (best balance)
- Modify `lib/sec/offerings-extractors.ts` to ALSO capture a "restriction" snippet whenever it sees lock-up/standstill phrases within the same filing where it's extracting an offering.
- Add an optional `restrictionSnippet` field to `RawOffering`.
- Prompt asks the LLM to summarize any non-null restriction snippets into the numbered list.

**Pros:** minimal new infrastructure, reuses the offerings filing scan already running (cached). Probably ~50–100 lines.
**Cons:** misses restrictions in filings without an offering match (e.g., a 10.X exhibit, an S-1 amendment with no priced takedown). Coupling restriction extraction to offering extraction is brittle long-term.

### Recommendation when this is unparked
**Start with A.3, watch quality, promote to A.1 if you find gaps.** A.3 piggybacks on infrastructure that already works and already costs nothing. Captures the 80% case — most lock-ups are tied to an offering filing, which is exactly when the offerings parser is reading the body. A few weeks of usage tells you whether the gap to A.1 is worth the build.

Avoid A.2 — raw filing text in prompts is the kind of cost growth that doesn't show up in any single line but creeps into the monthly bill.

### Open questions to answer before writing the spec
1. **Form scope.** Should restrictions show up from 8-Ks announcing PIPEs (lock-up on the *issuer*), from S-1s (lock-up on *insiders*), or both? They mean different things for dilution risk.
2. **Date window.** "Last 12 months" — from today, or from the most recent filing? (Matters for stale tickers.)
3. **Placement.** New tab vs. a card under the existing Dilution / Offering Risk sections in `ResearchReportSections.tsx`?
4. **Caching.** Same 16h TTL as the rest of the report (`CACHE_TTL_HOURS` in `app/api/research-report/route.ts:19`), or shorter since a new 8-K can change the answer?

### Triggers to revisit
- A trade decision is missed because a lock-up/restriction wasn't surfaced in time.
- Adding multiple new "insight" prompts becomes plausible — then it's worth building a generalized Insights feature (custom prompts table + UI) instead of bolting in one section. The Perplexity Insights model in the original screenshots is the reference for what that looks like.
- Ask Edgar adds a structured restrictions field on `/v1/offerings` or `/v1/registrations` — that would change the build-vs-buy calculus.

### What to check before acting
- Confirm `getFilingBody` (`lib/sec/filing-body.ts`) and `sec_filing_body_cache` still work the same way.
- Confirm `ENDPOINT_REGISTRY` and `ENDPOINT_SCOPES` in `lib/askedgar/endpoints.ts` still look the same.
- Re-check Ask Edgar's endpoint list — `/v1/agreements` may have improved, or a new restrictions-focused endpoint may exist.
- Sample 5–10 recent 424B and 8-K Item 1.01 filings from real small-cap tickers and confirm the restriction language matches the regex patterns planned for A.1/A.3.
- Re-read the prompt language above — it may have evolved since 2026-05-20.

---

## Historical Dilution Rating card (parked 2026-05-24)

### The idea
Render a "Dilution Rating as of {gap date}" card next to the Gap Up Days table on the Research tab, backed by Ask Edgar's `/v1/historical-dilution?ticker=X&date=YYYY-MM-DD` endpoint. Lets the user see what the dilution risk looked like on the specific day a ticker gapped — useful for backtest-style "was this trade trapped from the start" analysis.

### Why it's parked
**Cost.** AE bills $0.30 per cold call (verified live 2026-05-24 via throwaway probe — see commit `0d114bc` validation block in git history). Solo use can't justify that — one cold ticker view = $0.30, and the natural extension (one card per gap-row instead of just the most recent) would be 5–10× that per ticker. 30-day cache softens repeat views but every new ticker still re-pays.

Coworkers may want it badly enough to chip in. Revisit when the conversation happens.

### What was built (commit `0d114bc`, parked in commit that follows)
- **Route:** `app/api/historical-dilution-rating/route.ts` — `requireUser()` gate, Zod schema with 10-year date window refine (so an authed user can't burn $0.30 with `?date=1900-01-01`), reuses `askedgar_cache` table with `cache_type = 'historical-dilution-rating'` and composite key `${ticker}:${date}`, 30-day TTL, AE 429 → 429 response, AE other error → 503, DB write failure does not fail the user request.
- **Card:** `components/trading/research-report-sections/HistoricalDilutionRatingCard.tsx` — client component, `AbortController` cleanup for rapid ticker/date changes, 6×2 grid with `min-h-[280px]` for CLS prevention, uses `ratingLevel` + `pillClasses` from `_shared.tsx`.
- **Mount:** `OverviewSection.tsx` wrapped Gap Up Days in a `lg:flex-row` container and mounted the card to the right using `data.gapStats[0]?.date` (most recent gap only).
- **Tests:** `__tests__/historical-dilution-rating-route.test.ts` covered 9 cases — unauth 401, malformed date 400, out-of-window date 400, cache hit skips AE, cache miss calls AE + writes row, case-insensitive ticker, AE 429, AE 503, DB write failure still returns AE payload.

### What's still in the repo (safe to leave in place)
- `fetchHistoricalDilutionRating(ticker, date)` in `lib/askedgar/endpoints.ts` — small, not in `ENDPOINT_REGISTRY`, costs nothing if not called.
- `ratingLevel` + `pillClasses` exported from `components/trading/research-report-sections/_shared.tsx` — also consumed by `DilutionRatingTile.tsx`, so the extraction stands on its own.

### How to bring it back
1. `git show 0d114bc -- app/api/historical-dilution-rating/route.ts > app/api/historical-dilution-rating/route.ts` (recreate the route).
2. `git show 0d114bc -- components/trading/research-report-sections/HistoricalDilutionRatingCard.tsx > .../HistoricalDilutionRatingCard.tsx`.
3. `git show 0d114bc -- __tests__/historical-dilution-rating-route.test.ts > __tests__/historical-dilution-rating-route.test.ts`.
4. Re-add the import + mount in `OverviewSection.tsx` (wrap Gap Up Days in `lg:flex-row` and mount the card on the right — see commit `0d114bc` for the exact JSX).
5. Re-add `'historical-dilution-rating'` to the `cacheType` comment at `lib/db/schema.ts:145`.
6. Run `npm run lint && npx tsc --noEmit && npm test`.

### Triggers to revisit
- A coworker commits to splitting the AE bill for this surface.
- AE drops the per-call price on `/v1/historical-dilution` (it's noticeably more expensive than other AE endpoints today — most are $0.01).
- A trade decision is missed because a historical rating wasn't visible at the right gap date.

### What to check before acting
- Confirm AE endpoint path + response shape haven't changed (`/v1/historical-dilution?ticker=X&date=YYYY-MM-DD`).
- Re-probe the cost via a throwaway script against a fresh ticker (the AE `usage.duplicate: true` dedup will return $0 for recently-queried tickers — pick something cold).
- Confirm `askedgar_cache` schema is unchanged (unbounded `ticker text`, unique on `(cacheType, ticker)`).
