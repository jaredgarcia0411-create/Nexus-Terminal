# FUTURE-PLANS.md

Parked ideas and longer-horizon plans. Each entry should note **why it's parked** and what would unblock it.

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
