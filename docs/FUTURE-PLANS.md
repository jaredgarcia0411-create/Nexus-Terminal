# FUTURE-PLANS.md

Parked ideas and longer-horizon plans. Each entry should note **why it's parked** and what would unblock it.

---

## Recurring chores (not parked — just a checklist)

- **`docs/ARCHITECTURE.md` freshness** — review at the end of each sprint. Update only when structure changes meaningfully (new top-level concern, folder reorg, new agent surface, new convention). Skip if nothing structural shifted. Stale architecture docs are worse than no architecture docs.

---

## Replacing NextAuth with Clerk (research note parked 2026-05-31)

### Bottom Line

I would not switch to Clerk solely because the Google Cloud free trial is ending. Based on Google's free-trial docs, the trial ending can close billing and stop project resources if you do not upgrade, but basic Google OAuth sign-in is not documented as a per-login paid SKU. The lower-risk move is likely to upgrade/keep the Google Cloud project active and keep current NextAuth for now.

Clerk is still a credible future upgrade if you want hosted user lifecycle, public signup, account management, MFA, organizations, billing-aware auth, or multi-provider auth. For this codebase, though, it is a **medium-large auth migration**, not a login-button swap.

### What Makes It Big

The current system is centralized but identity-sensitive:

- NextAuth config is in [lib/auth-config.ts](/home/jared/Nexus-Terminal/lib/auth-config.ts:16): Google provider, JWT sessions, `/login`, and `ALLOWED_EMAILS`.
- Protected APIs mostly go through [requireUser()](/home/jared/Nexus-Terminal/lib/server-db-utils.ts:15) and [ensureUser()](/home/jared/Nexus-Terminal/lib/server-db-utils.ts:32).
- `middleware.ts` protects pages but excludes all `/api`, so API security depends on `requireUser()` directly.
- The DB uses [users.id](/home/jared/Nexus-Terminal/lib/db/schema.ts:5) as the ownership root for trades, tags, reports, reviews, backtests, imports, agent service calls, etc.
- Client code depends on NextAuth in [app/layout.tsx](/home/jared/Nexus-Terminal/app/layout.tsx:18), [app/login/page.tsx](/home/jared/Nexus-Terminal/app/login/page.tsx:23), [app/page.tsx](/home/jared/Nexus-Terminal/app/page.tsx:125), and several hooks.

The critical migration decision is user ID mapping. Clerk generates its own user IDs. If we blindly use Clerk IDs as `users.id`, existing users can appear to have empty data. Clerk's Auth.js migration guide explicitly calls out this foreign-key issue and suggests using Clerk `externalId` or updating DB foreign keys. For Nexus, I'd preserve current `users.id` as canonical and map Clerk users onto it.

### Implementation Shape

A safe migration would be phased:

1. Add Clerk package/env and replace `SessionProvider` with `ClerkProvider`.
2. Replace NextAuth middleware with `clerkMiddleware()`, preserving current protected/public route behavior.
3. Rewrite `requireUser()` to source auth from Clerk while returning the same `{ user } | { error }` contract.
4. Preserve `ensureUser()` canonical ID behavior and make sure Clerk identity maps to the existing DB user by external ID or verified email.
5. Replace login/sign-out/client hooks with Clerk equivalents.
6. Remove NextAuth route/config only after API, page, and data ownership smoke tests pass.

I would avoid rewriting every API route to call Clerk directly. There are dozens of `requireUser()` users; keeping that helper as the compatibility layer contains the blast radius.

### Switching To Clerk: Pros

- Better hosted auth product: sign-in/sign-up, user profile, account management, session UI.
- Current Next.js App Router support via `@clerk/nextjs`, `ClerkProvider`, `clerkMiddleware()`, and server `auth()`.
- Social login, email codes/links, passwords, account linking, user metadata, webhooks, and user exports are available.
- Current pricing page, checked May 31, 2026, says Hobby is free up to **50,000 monthly retained users**, not 10,000.
- Useful future features for Nexus: allowlist/invitations, user profile, bot protection, leaked-password checks, MFA on Pro, organizations, billing-aware authorization.

### Switching To Clerk: Cons

- Migration risk is concentrated around `users.id` ownership.
- Clerk free tier has meaningful limits: fixed 7-day session lifetime, Clerk branding, MFA/custom session lifetime on Pro per current pricing.
- Still may need Google OAuth credentials for production Google social login through Clerk.
- Adds external vendor lock-in and pricing-plan drift risk.
- Requires env/Vercel/dashboard setup, callback URL changes, test rewrites, and careful rollout.

### Staying With Current NextAuth: Pros

- Lowest implementation risk.
- Existing tests and API routes already fit the `requireUser()`/`ensureUser()` model.
- Current allowlist is simple and server-side.
- Google OAuth for basic sign-in does not appear to require per-login billing; the real concern is keeping the Cloud project/billing state active.
- No user-ID migration.

### Staying With Current NextAuth: Cons

- You remain on `next-auth@5.0.0-beta.30`.
- You own all account lifecycle work if you later want email/password, password reset, MFA, account settings, invite flows, etc.
- Google OAuth setup remains yours to maintain in Google Cloud.
- More manual work if Nexus becomes a public SaaS.

### Clerk Features Worth Considering

- **Use early:** Google/social login, hosted sign-in/sign-up, `UserButton`, user profile, bot protection, account linking, session/device management.
- **Use if Nexus opens signup:** invitations or allowlist/blocklist, disposable email blocking, email/password or email-code login.
- **Use later/productized:** organizations, roles/permissions, billing-aware authorization, webhooks for syncing Clerk user data to `users`.
- **Probably defer:** MFA, passkeys, custom session lifetime, SSO/SAML, custom roles, unless you are ready for paid-plan features.

### Recommendation

For the next 30 days, I'd first verify the Google Cloud project status and OAuth consent status. If upgrading the billing account keeps the OAuth project active without meaningful cost, stay on NextAuth for now.

If you still want Clerk, make the first spec narrow: "Clerk session in, canonical Nexus DB user ID out." Do not start with UI polish or new Clerk features. The success criterion should be that an existing user signs in through Clerk and sees the exact same trades/tags/reviews as before.

Sources used: Clerk [Next.js quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart), [middleware docs](https://clerk.com/docs/reference/nextjs/clerk-middleware), [auth docs](https://clerk.com/docs/reference/nextjs/app-router/auth), [Auth.js migration guide](https://clerk.com/docs/guides/development/migrating/authjs), [pricing](https://clerk.com/pricing), Google Cloud [free trial docs](https://docs.cloud.google.com/free/docs/free-cloud-features), and Google [OAuth consent docs](https://developers.google.com/workspace/guides/configure-oauth-consent). No files were changed or tests run.

---

## Internal research sheets / spreadsheet workspace (parked 2026-05-30)

### The idea
Add a Management > Sheets workspace that feels close to Google Sheets / Excel for internal trading research:

- Saved sheets with names, blank-sheet creation, rename/duplicate/delete, and a sheet picker.
- Rows added manually one by one, plus an "Add to Sheets" action from Research.
- User-defined columns that can be plain text, date, number, URL/reference, checkbox, or dropdown.
- Dropdown columns where the team can add/edit options and reuse them in that column.
- Spreadsheet-like keyboard flow: click/edit, tab/enter navigation, paste small ranges, undo/redo if practical.
- A default research sheet shape with columns like Date, Ticker, Chart, Report, Company Details, Bucket, Sub Bucket, Bias, Theme, News, Locate Avail, PIPE?, Float, Notes.

The useful product is not a generic Excel clone. It is a team research notebook where tickers, dates, reports, charts, and small-cap metadata land in a structured grid without needing a separate Google Sheet.

### Current recommendation
Start with a **DB-backed structured grid MVP**, not true Google-Sheets-style live multiplayer.

The realistic v1 should let the user and two coworkers open the same sheet and make edits safely, but it does not need live cursors, per-keystroke remote updates, CRDT merge semantics, or formulas. Use optimistic row/cell versioning and refresh/polling so conflicting edits are detected instead of silently overwritten.

Treat true simultaneous editing as phase 2. If the team later needs live cursors and conflict-free concurrent cell edits, use a hosted realtime/collaboration backend such as Liveblocks/Yjs rather than trying to host a WebSocket/CRDT server inside Vercel Functions.

### UI/library options checked 2026-05-30

| Option | Fit | Notes |
|---|---|---|
| **AG Grid Community** | Best v1 fit if this is a structured grid of research rows. | MIT/free community tier. React/TypeScript support, editable cells, basic provided editors including select, sorting/filtering, resizing, theming, and a mature API. Enterprise gates richer spreadsheet features such as range selection, rich select, batch editing, integrated charts, and Excel-style extras. Pricing page currently lists AG Grid Enterprise from `$999/developer`. Sources: https://www.ag-grid.com/react-data-grid/cell-editing/, https://www.ag-grid.com/react-data-grid/provided-cell-editors/, https://www.ag-grid.com/license-pricing/ |
| **Glide Data Grid** | Best license-safe custom sheet surface if avoiding paid grid licensing matters. | MIT, fast canvas grid, editable cells, custom cells, row append callbacks, multi-selection, movable/resizable columns. More implementation work: dropdown editors, persistence, column config UI, import/export, and formula semantics would be ours. Sources: https://github.com/glideapps/glide-data-grid, https://docs.grid.glideapps.com/api/dataeditor/editing |
| **Handsontable** | Closest out-of-box "spreadsheet" UX. | Strong for spreadsheet feel: dropdown cells, row/column operations, copy/paste, formulas via HyperFormula. Licensing is the gating issue: production commercial use requires a paid commercial license; HyperFormula has GPLv3/noncommercial/proprietary licensing constraints outside permitted commercial use. Sources: https://handsontable.com/docs/react-data-grid/dropdown-cell-type/, https://handsontable.com/docs/react-data-grid/software-license/, https://hyperformula.handsontable.com/docs/guide/licensing.html |
| **TanStack Table** | Not a good spreadsheet core. | Great headless table state for normal app tables, but it supplies no spreadsheet UI, keyboard model, fill/range behavior, paste semantics, or dropdown editor UX by default. Use it elsewhere, not as the sheet engine. Source: https://tanstack.com/table/v8/docs/framework/react/examples/editable-data |

Recommendation: **AG Grid Community first**, unless the first implementation proves that AG Grid's community feature gates block core workflows. If license risk or visual control matters more than speed, choose Glide Data Grid and accept more custom work. Do not pick Handsontable without deciding that paid licensing is acceptable.

### Current repo seams

- `components/trading/ManagementTab.tsx` owns the Management subtabs. A new `sheets` subtab belongs there, likely rendered by a new `components/trading/SheetsTab.tsx`.
- `app/page.tsx` already mounts `ManagementTab` and `ResearchTab`; keep orchestration there and avoid pushing this into `use-trades.ts`.
- `components/trading/ResearchTickerView.tsx` already has the `AddToWatchlistButton` pattern. Add a sibling "Add to Sheets" action there, but do not force the Research page to know grid internals.
- `components/trading/ResearchReportPanel.tsx` exposes `getCachedReportId(ticker)` / `prefetchResearchReport(ticker)`, which is how the watchlist captures a specific `research_reports.id`.
- `app/api/daily-reviews/append-watchlist/route.ts` is the closest "append research thing into another surface" route, but sheets should tighten report ownership/visibility validation before copying the pattern.
- `lib/askedgar/snapshot-normalizer.ts` already normalizes `ResearchSnapshot.header.country`, `industry`, `outstandingShares`, and `float`; `components/trading/ResearchCompanyHeader.tsx` displays the same values. These are the right source fields for the new Company Details column.
- `sample_sets` and `system_tickers` are useful analogs, not foundations. `sample_sets.rows` is too narrow (`ticker`, `date` only), and `system_tickers` is a shared imported Google Sheet log without sheet ids, ACLs, or editable workbook semantics.

### Data model direction

Do not store a whole sheet as one JSON blob. That would recreate last-write-wins review-sheet behavior and make coworker edits unsafe.

Recommended v1 tables:

- `sheets`: `id`, `ownerUserId`, `name`, `description`, `defaultView`, `createdAt`, `updatedAt`, optional `archivedAt`.
- `sheet_members`: `sheetId`, `userId`, `role` (`owner`, `editor`, `viewer`), timestamps. Even if the first version makes all coworkers editors, model it explicitly.
- `sheet_columns`: `id`, `sheetId`, `key`, `name`, `type`, `order`, `width`, `optionsJson`, `required`, `createdAt`, `updatedAt`.
- `sheet_rows`: `id`, `sheetId`, `order`, `valuesJson`, `version`, `createdByUserId`, `updatedByUserId`, timestamps.
- Optional later: `sheet_cell_events` or normalized `sheet_cells` if cell-level history, audit, formulas, or true concurrent edits become important.

For v1, row-level JSON values plus a row `version` is probably enough. Patch a single row at a time with `WHERE id = ? AND version = ?`; return `409` when stale. This lets multiple people edit different rows safely and makes same-row conflicts explicit.

### Research "Add to Sheets" behavior

Add a button near "Add to Watchlist" in `ResearchTickerView`.

Initial behavior:

1. User chooses a target sheet, or the app uses a default "Research" sheet if one exists.
2. Client posts to a new route such as `POST /api/sheets/[id]/append-research-row`.
3. Route requires `requireUser()`, verifies editor access, validates ticker/date/report id, and appends one row.
4. Row populates:
   - Date: user's local date or selected historical gap date if the action is tied to a gap row.
   - Ticker: current Research ticker.
   - Chart: a typed reference object, not a screenshot. Store enough state to reopen the chart: ticker, date/historicalDate, timeframe if available.
   - Report: `research_reports.id` if a cached/generated report exists; otherwise blank with an affordance to attach/generate later.
   - Company Details: country, industry, float, outstanding shares from the normalized Research snapshot header.
5. Dedupe should be per sheet by `(ticker, date)` or by `(ticker, date, reportId)` depending on desired workflow. Return `{ duplicate: true }` like the watchlist route if no row is created.

Important: the Add to Sheets action should not secretly trigger paid Research Report generation. It can attach an already-ready report id, or leave the Report cell blank if a report is still loading. A separate explicit generate/attach action can come later.

### Collaboration options

Practical v1:

- DB is source of truth.
- Edits are saved through small patch endpoints.
- Each row has a version.
- Client does optimistic updates and handles `409` by reloading the row and showing a conflict toast.
- Poll the sheet metadata/updated rows every few seconds, or add an SSE invalidation channel later. This is enough for three coworkers if edits are not usually on the exact same cell at the same moment.

True live collaboration:

- Use Liveblocks/Yjs or a similar hosted realtime provider if live cursors, presence, CRDT merges, offline edits, and per-keystroke sync become required.
- Liveblocks Storage is explicitly designed for persistent realtime collaborative data such as spreadsheet cells and exposes conflict-free data types. Current pricing has a free plan for prototyping and paid production plans/usage. Sources: https://liveblocks.io/docs/tutorial/react/getting-started/storage, https://liveblocks.io/docs/pricing/plans, https://liveblocks.io/docs/platform/limits
- Yjs supports shared maps/arrays and y-websocket, but self-hosting y-websocket requires a long-lived WebSocket service and persistence/scaling decisions. Source: https://docs.yjs.dev/getting-started/working-with-shared-types, https://docs.yjs.dev/ecosystem/connection-provider/y-websocket
- Supabase Realtime/Pusher-style services are good for presence, broadcasts, and invalidation, but they do not provide spreadsheet conflict resolution by themselves. Source: https://supabase.com/docs/guides/realtime
- Vercel Functions should not be treated as a WebSocket server. Vercel's docs say Functions do not support acting as a WebSocket server and recommend third-party realtime solutions. Source: https://vercel.com/docs/limits/overview

### Good feature additions

- Saved views: Default, Today, Unreviewed, Long, Short, Backtest Candidates.
- Column presets/templates: Research, Watchlist Review, Backtest Candidates, Offerings/Dilution Review.
- Row source badges: Manual, Research, Watchlist, Sample Set, System Sheet.
- Attachments/references: chart reference, research report id, SEC filing URL, news URL.
- Export CSV for sharing/backtesting.
- Convert selected rows to sample set, reusing the existing sample-set idea but with richer sheet context.
- Basic audit fields: created by, updated by, updated at, last source.
- Row comments/notes later, not v1.

### Risks and guardrails

- **Realtime is the trap.** Full Google Sheets collaboration is substantially more complex than a useful shared research grid. Do not start there unless it becomes the main product requirement.
- **Do not reuse `system_tickers` as the workbook model.** It is a shared imported log, not an editable sheet.
- **Do not copy review-sheet JSON blob saves.** They are fine for single-user review forms but unsafe for collaborative editing.
- **Do not add this to `hooks/use-trades.ts`.** Use a new `hooks/use-sheets.ts` or feature-local hooks.
- **Validate aggressively.** Use Zod max bounds for sheet names, column names, dropdown options, row values, and batch sizes.
- **Keep AskEdgar costs explicit.** Import only already-normalized snapshot data; never trigger paid endpoint fanout or LLM report generation as a hidden side effect of adding a row.
- **Handle report ids carefully.** If sheets embed `research_reports.id`, verify access and decide whether reports are team-visible or user-owned.

### Phased implementation plan

1. **Schema + routes:** add `sheets`, `sheet_members`, `sheet_columns`, `sheet_rows`; CRUD routes under `app/api/sheets`; Zod schemas under `lib/validations/sheets.ts`; route tests for auth, ACL, validation, and version conflicts.
2. **Management UI MVP:** add `SheetsTab` under Management with sheet picker, create/rename/delete, a default Research template, add row/column, dropdown option editor, and save-on-cell-commit.
3. **Research import:** add `Add to Sheets` beside `Add to Watchlist`; append ticker/date/chart/report/company-details row; dedupe and toast success/duplicate/error.
4. **Team sharing:** expose member roles and sheet visibility rules; make coworker access explicit.
5. **Collaboration polish:** polling/SSE invalidation, presence indicator if useful, conflict UX.
6. **Optional live multiplayer:** only after v1 usage proves it is worth adding Liveblocks/Yjs or another managed realtime layer.

### Why it is parked
This is a substantial product surface: schema, ACLs, routes, a grid dependency, research integration, tests, and a new Management tab. It should be a dedicated sprint, not bundled with cleanup or small Research polish.

### Triggers to revisit

- Google Sheets becomes a daily team bottleneck.
- Coworkers actively need to edit the same research list inside Nexus.
- Research-to-watchlist/sample-set flow is not enough because the team needs richer per-ticker notes and dropdown classifications.
- The team agrees whether v1 collaboration means conflict-safe shared editing or true live multiplayer.

---

## Filing headline parser for Research Filings (parked 2026-05-25)

### The idea
Improve the Research > Filings headline column so every filing has a compact one-line explanation instead of falling back to generic SEC metadata like `10-Q filing` or `Form 425 - Prospectuses and communications, business combinations`.

Target shape:
- `8-K: Item 5.03 - charter/bylaw amendment or fiscal year change`
- `S-1/A: amended registration statement`
- `424B5: prospectus supplement`
- `10-Q: quarterly report`
- `SC 13G/A: amended beneficial ownership report`

This is intentionally not the same as a full AI filing summary. It is a deterministic, trader-readable headline built from SEC metadata first.

### LLM answer
To produce genuinely semantic headlines like "Auddia announces 1-for-77 reverse stock split" or "Auddia enters exchange agreement to retire Series C preferred stock" for arbitrary filings, we usually need one of:

1. A source headline already present in the filing payload or primary document title.
2. A targeted parser for that specific form/event pattern.
3. An LLM call over selected filing text.

The parser can cover generic one-line labels and many common small-cap filing patterns, but it should not pretend to understand every filing body. For arbitrary event-specific prose, use a cached LLM summary lane later.

### Current repo seams
- `lib/sec/submissions.ts` builds first-party SEC filing rows. It currently sets `headline` to `primaryDocDescription` or `${formType} filing`.
- `lib/askedgar/snapshot-normalizer.ts` maps SEC filing rows into `ResearchSnapshotFiling.title`.
- `components/trading/research-report-sections/_shared.tsx` renders `filing.title` in the Filings table headline column.
- `lib/sec/filing-body.ts` can fetch and cache primary-document text by accession number, but the Filings tab currently does not use it.
- `sec_filings_raw` stores metadata separately from `sec_filing_body_cache`, which is the right split for parser-first work.

### Parser-first implementation strategy
1. Add a helper such as `lib/sec/filing-summary.ts`.
2. Export a pure function like:
   ```ts
   summarizeFilingMetadata({
     formType,
     items,
     primaryDocDescription,
     headline,
   }): string
   ```
3. Keep it metadata-only for v1. Do not fetch filing bodies in the Filings tab path.
4. Add an optional `summary` or `displayHeadline` field to `SecFiling` and `ResearchSnapshotFiling`, leaving `title` available as the source/raw headline.
5. In `lib/sec/submissions.ts`, compute the parser headline when zipping SEC filing columns.
6. In `lib/askedgar/snapshot-normalizer.ts`, prefer `summary` / `displayHeadline`, then source `headline`, then `${formType} filing`.
7. In the UI, render the parser headline in the existing Headline column. Consider preserving the original SEC title in a tooltip or secondary muted text later.

### Parser rules to start with
Use a small explicit taxonomy. Prefer boring correctness over clever inference.

| Source | Rule |
|---|---|
| `10-Q`, `10-Q/A` | quarterly report / amended quarterly report |
| `10-K`, `10-K/A` | annual report / amended annual report |
| `8-K`, `8-K/A` + `items` | current report with item labels |
| `6-K`, `6-K/A` | foreign issuer current report |
| `S-1`, `S-1/A`, `S-3`, `S-3/A`, `F-1`, `F-3` | registration statement, amended when `/A` |
| `424B*` | prospectus supplement |
| `425` | merger/business-combination communication |
| `DEF 14A`, `PRE 14A` | proxy statement / preliminary proxy statement |
| `SC 13G`, `SC 13D`, amendments | beneficial ownership report |
| `3`, `4`, `5` | insider ownership / transaction report |
| `144` | proposed sale of securities |

For 8-K items, map common item codes:
- `1.01` - material definitive agreement
- `2.02` - results of operations / financial condition
- `3.01` - exchange listing notice
- `3.02` - unregistered sale of equity securities
- `5.02` - director/officer change or compensation arrangement
- `5.03` - charter/bylaw amendment or fiscal-year change
- `7.01` - Regulation FD disclosure
- `8.01` - other event
- `9.01` - financial statements and exhibits

If multiple 8-K items are present, include up to two business-relevant items and drop `9.01` when it is only an exhibit companion to another item.

### Body-parser extension
After the metadata parser is stable, add lazy body parsing only for high-value candidates:
- `8-K` / `8-K/A`
- `S-1`, `S-1/A`, `S-3`, `S-3/A`, `F-1`, `F-3`
- `424B*`
- `425`

Use `lib/sec/filing-body.ts` and `sec_filing_body_cache`; keep body fetching candidate-based and never fetch bodies for every row in a 300-filing Research Filings response.

Parser examples:
- reverse split ratio from 8-K Item 5.03 body text
- registration / resale / ATM / shelf keywords from S-1/S-3/424B bodies
- merger or acquisition keywords from 425 bodies
- executive change names from 8-K Item 5.02 bodies, only if confidently matched

### Optional LLM extension
Add LLM summaries only after parser output is useful and cached:
1. Create a `sec_filing_summaries` table keyed by accession number.
2. Store `parserSummary`, `llmSummary`, `source`, `model`, token/cost metadata, `createdAt`, and `updatedAt`.
3. Generate LLM summaries asynchronously or behind an explicit "summarize filing" action.
4. Use strict prompts: one sentence, no advice, quote only supported facts, include form/date/item context.
5. Fall back to parser output on timeout, missing API key, or budget exhaustion.
6. Put route-level rate limiting in place before exposing batch LLM summaries.

### Acceptance criteria for parser v1
- No LLM API call is required.
- No filing body fetch is required in the default Filings tab render path.
- Existing SEC source fields remain available for debugging and future parser work.
- The headline column no longer shows unhelpful fallbacks for common forms.
- Unit tests cover common form types, 8-K item combinations, amendments, unknown forms, and missing metadata.

### Why it is parked
This is valuable UI polish, but it should be a focused filings sprint. It touches the SEC data contract, normalized Research snapshot shape, and Filings UI display. It should not be bundled with unrelated cleanup or rate-limiting work.

### Triggers to revisit
- The Filings tab becomes a daily workflow surface.
- Generic SEC headlines are slowing down review.
- We need to reduce AskEdgar headline reliance without losing readability.
- We are ready to add cached LLM summaries with rate limits and cost accounting.

---

## Commercialization paths for Nexus Terminal (parked 2026-05-24)

### The idea
Monetize the repo without turning it into a broad venture-backed SaaS: sell a sanitized private repo as a self-hosted starter kit. Customers bring their own Vercel, Neon, Massive/Polygon, AskEdgar, broker exports, and LLM keys. They manage their own env vars, spend, deployment, and custom parser tweaks.

### Current recommendation
**Sell the source-access / self-hosted product.** It fits the current codebase and avoids the hardest support, vendor-licensing, and on-call burden. (A managed-SaaS path was considered and dropped: vendor licensing for AskEdgar and Massive/Polygon makes hosting other users' data unworkable without written business agreements.)

### Source-access / self-hosted starter kit

#### What to sell
Package a separate repo, for example `nexus-terminal-starter`, as:

> A self-hosted Next.js trading journal, research, scanner, and AI-agent scaffold for traders who want their own private trading system instead of another SaaS dashboard.

This should not be the live personal repo. Create a sanitized duplicate with:
- No personal agent configs, local workflow artifacts, private email gates, or old experiments.
- A clean `.env.example` and `ENVIRONMENT.md` covering required vs optional providers.
- `DEPLOY.md` for Vercel + Neon + migrations + local dev.
- A broker parser adapter interface and examples.
- Options import support as a value-add feature.
- Scanner defaults as editable JSONLogic presets, not blank parameters that feel broken.
- AI customization recipes, e.g. "paste your broker CSV/sample into Codex and implement this parser interface."

#### Pricing hypothesis
For a first version:
- **Founder source license:** `$499-$1,499` one-time.
- **Setup package:** `$1,000-$3,000` for guided install, Vercel/Neon wiring, env vars, first deploy, and one broker parser.
- **Optional update access:** `$199-$499/year` or bundled for 6-12 months.
- **Optional paid modules:** broker parser packs, options import, scanner rule packs, AskEdgar report templates, research prompt packs.

This is not priced against normal trading journals. It is priced against "I want a private AI-modifiable system without starting from zero."

#### Delivery model
- Private GitHub repo access, preferably under a commercial source license with no redistribution/resale.
- Consider Polar for payment + automated private GitHub repository access. Polar explicitly supports GitHub repo access as an automated benefit: https://docs.polar.sh/features/benefits/introduction
- GitHub outside collaborator access works, but org-owned private repos can consume paid seats depending on plan: https://docs.github.com/organizations/managing-user-access-to-your-organizations-repositories/managing-outside-collaborators/adding-outside-collaborators-to-repositories-in-your-organization/
- Vercel Deploy Button / clone flow can prompt for env var keys, but it works best for public/template repos. For a paid private repo, the realistic path is: customer receives repo access -> forks/clones -> imports into Vercel -> sets env vars. Vercel env docs: https://vercel.com/docs/environment-variables

#### Pros
- Lowest ongoing support obligation.
- Customers own their data, API keys, infra bills, and deployment risk.
- Avoids reselling market data or AskEdgar data through a shared app.
- Better fit for AI-agent users who expect to modify source.
- Can be sold before the app is polished enough for mainstream SaaS onboarding.

#### Cons
- Source code can leak after purchase. A license helps but does not technically prevent copying.
- Market is smaller: the buyer needs to be technical or comfortable using Codex/Claude.
- Documentation quality becomes the product.
- Every buyer's local changes can diverge, making support harder unless support is scoped tightly.
- Some buyers will expect "SaaS support" even though they bought source access; terms need to be explicit.

#### Before launch
1. Create a clean commercial branch/repo with no personal data, secrets, or unnecessary workflow baggage.
2. Write a commercial source license and support boundary. Have counsel review it.
3. Add `ENVIRONMENT.md`, `DEPLOY.md`, `CUSTOMIZE.md`, and parser examples.
4. Build options trade import and a parser adapter contract.
5. Create a setup checklist that assumes the customer has their own provider keys.
6. Avoid bundling AskEdgar, Massive/Polygon, TradingView, broker, or LLM credentials.

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
