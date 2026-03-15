# Build Spec — Schwab Real-Time Market Data (Option C Hybrid)
> Generated: 2026-03-15 | Agent: nexus-architect
> Status: PENDING REVIEW — do not execute until approved

## Objective

Add real-time market data to Nexus Terminal by integrating Charles Schwab's streaming API. The authenticated Schwab user gets live prices; all other users continue to see 15-min delayed Massive data. A small relay service running on Fly.io maintains the Schwab WebSocket connection and writes quotes to the database. The existing Next.js app reads from that table and serves the appropriate data source per user.

## Current State

### Market Data Flow (Massive Only)
- `lib/massive-market.ts` — Helper functions for Massive/Polygon REST API (snapshot, movers, daily summaries)
- `app/api/market-data/snapshot/route.ts` — Fetches snapshot from Massive, caches in `marketSnapshots` table (2-min TTL), serves to all users identically
- `app/api/market-data/route.ts` — Proxies candlestick/aggregate data from Massive for Charts tab
- `components/trading/MarketsTab.tsx` — Displays snapshot data, polls every 60s, shows "delayed by approximately 15 minutes" banner
- `hooks/use-candle-data.ts` — Client-side hook for chart data fetching

### Database
- Schema at `lib/db/schema.ts` — 15 tables, no Schwab-related tables exist
- `marketSnapshots` table stores cached JSON blobs with TTL
- Connection via `lib/db.ts` — HTTP client (`getDb()`) for reads, Pool client (`getPoolDb()`) for transactions

### Auth
- Google OAuth via NextAuth v5 (`lib/auth-config.ts`)
- `requireUser()` in `lib/server-db-utils.ts` gates all API routes
- `users` table has: id, email, name, picture, googleId, username, passwordHash

### Relay Service Directory
- `services/` exists but only contains a legacy `discord-bot/` with compiled JS artifacts
- `tsconfig.json` already excludes `services/` from compilation (line 27)

### Schwab Legacy
- `app/api/schwab/` directory does NOT exist (confirmed empty)
- No Schwab-related code exists anywhere in the codebase

---

## Phase 1: Schwab OAuth Integration

### Change 1.1: Add new environment variables
- **File:** `.env.example`
- **Action:** MODIFY
- **Description:** Append Schwab-related env vars to the template. These are documentation only — actual values go in `.env.local`.
- **What to add** (append after the `MASSIVE_API_KEY=` section):
  ```
  # Schwab API (optional — enables real-time market data for linked user)
  SCHWAB_CLIENT_ID=
  SCHWAB_CLIENT_SECRET=
  SCHWAB_REDIRECT_URI=http://localhost:3000/api/schwab/callback
  SCHWAB_TOKEN_ENCRYPTION_KEY=
  # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  
  # Schwab Relay Service
  RELAY_SERVICE_SECRET=
  # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Acceptance Criteria:**
  - [ ] `.env.example` contains all 5 new Schwab env vars with comments
  - [ ] No actual secret values are committed

### Change 1.2: Add `schwabLinks` table to the database schema
- **File:** `lib/db/schema.ts`
- **Action:** MODIFY
- **Description:** Add a new table to store Schwab OAuth tokens (encrypted) and link status per user. Only one user can have a Schwab link at a time in this system, but we model it per-user for flexibility. Tokens are stored as AES-256-GCM encrypted blobs (the encryption/decryption happens in a helper module, not in the schema).
- **What to add** (after the `jarvisRequestLog` table definition, before the file ends):
  ```typescript
  export const schwabLinks = pgTable('schwab_links', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Encrypted JSON blob containing { accessToken, refreshToken, expiresAt, refreshExpiresAt }
    encryptedTokens: text('encrypted_tokens').notNull(),
    // IV for AES-256-GCM decryption (hex string)
    tokenIv: text('token_iv').notNull(),
    // Auth tag for AES-256-GCM (hex string)
    tokenTag: text('token_tag').notNull(),
    // Schwab account number hash (for display, NOT the actual account number)
    accountLabel: text('account_label'),
    // Whether this link is currently active and tokens are valid
    status: text('status', { enum: ['active', 'expired', 'revoked'] }).notNull().default('active'),
    // When the access token expires (UTC) — used by relay to know when to refresh
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
    // When the refresh token expires (UTC) — hard 7-day limit from Schwab
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  }, (table) => [
    unique().on(table.userId),
    index('schwab_links_status_idx').on(table.status),
  ]);
  ```
- **Why this design:**
  - Tokens are encrypted at rest — if the database is compromised, tokens are useless without the encryption key.
  - `unique().on(table.userId)` ensures one link per user.
  - `status` column lets the relay service quickly find active links without decrypting.
  - Separate `accessTokenExpiresAt` and `refreshTokenExpiresAt` columns avoid the need to decrypt just to check expiry.
- **Acceptance Criteria:**
  - [ ] `schwabLinks` table is exported from schema.ts
  - [ ] Has unique constraint on userId
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** None

### Change 1.3: Add `realtimeQuotes` table to the database schema
- **File:** `lib/db/schema.ts`
- **Action:** MODIFY
- **Description:** Add a table for the relay service to write real-time quote data into. The snapshot route will read from this table when the requesting user has an active Schwab link. This table also serves as the scanner foundation (Phase 4).
- **What to add** (after the `schwabLinks` table):
  ```typescript
  export const realtimeQuotes = pgTable('realtime_quotes', {
    symbol: text('symbol').primaryKey(),
    // Asset class for filtering
    assetType: text('asset_type', { enum: ['equity', 'etf', 'future', 'forex', 'index', 'crypto'] }).notNull().default('equity'),
    // Core price fields
    lastPrice: doublePrecision('last_price'),
    bidPrice: doublePrecision('bid_price'),
    askPrice: doublePrecision('ask_price'),
    openPrice: doublePrecision('open_price'),
    highPrice: doublePrecision('high_price'),
    lowPrice: doublePrecision('low_price'),
    closePrice: doublePrecision('close_price'),
    // Change fields
    netChange: doublePrecision('net_change'),
    netChangePercent: doublePrecision('net_change_percent'),
    // Volume
    totalVolume: doublePrecision('total_volume'),
    // Metadata
    exchangeId: text('exchange_id'),
    description: text('description'),
    securityStatus: text('security_status'),
    // Timestamp of the last quote update from Schwab (ms since epoch)
    quoteTimeMs: doublePrecision('quote_time_ms'),
    // When the relay service last wrote this row
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  }, (table) => [
    index('realtime_quotes_asset_type_idx').on(table.assetType),
    index('realtime_quotes_updated_at_idx').on(table.updatedAt),
  ]);
  ```
- **Why this design:**
  - `symbol` as primary key means each instrument has exactly one row that gets upserted.
  - `assetType` allows the snapshot route to filter by category (equities vs futures vs forex).
  - Fields match what Schwab L1 streaming provides (see field maps in streaming protocol docs).
  - `quoteTimeMs` is the Schwab-provided timestamp; `updatedAt` is when the relay wrote it.
  - Scanner queries (Phase 4) will filter on `netChangePercent`, `totalVolume`, `assetType`.
- **Acceptance Criteria:**
  - [ ] `realtimeQuotes` table is exported from schema.ts
  - [ ] Primary key is `symbol`
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** None

### Change 1.4: Run database migration
- **Action:** Run commands (no file edit)
- **Description:** Generate and apply the migration for the two new tables.
- **Commands:**
  ```bash
  npm run db:generate
  npm run db:migrate
  ```
- **Acceptance Criteria:**
  - [ ] Migration file created in `drizzle/` directory
  - [ ] Migration applied successfully
  - [ ] Both `schwab_links` and `realtime_quotes` tables exist in the database
- **Dependencies:** Changes 1.2, 1.3

### Change 1.5: Create Schwab token encryption helper
- **File:** `lib/schwab/crypto.ts`
- **Action:** CREATE
- **Description:** A small server-only module that encrypts and decrypts Schwab tokens using AES-256-GCM. This uses Node.js built-in `crypto` module — no new dependencies needed. The encryption key comes from `SCHWAB_TOKEN_ENCRYPTION_KEY` env var (a 64-char hex string = 32 bytes).
- **What the file should contain:**
  - A type `SchwabTokenPayload` with fields: `accessToken: string`, `refreshToken: string`, `expiresAt: string` (ISO date), `refreshExpiresAt: string` (ISO date)
  - A function `encryptTokens(payload: SchwabTokenPayload)` that:
    1. Reads `SCHWAB_TOKEN_ENCRYPTION_KEY` from env, throws if missing
    2. Converts the hex string to a 32-byte Buffer
    3. Generates a random 16-byte IV
    4. Creates an AES-256-GCM cipher with the key and IV
    5. Encrypts `JSON.stringify(payload)`
    6. Returns `{ encrypted: string (hex), iv: string (hex), tag: string (hex) }`
  - A function `decryptTokens(encrypted: string, iv: string, tag: string): SchwabTokenPayload` that:
    1. Reads the encryption key from env
    2. Creates a decipher with the key, IV, and auth tag
    3. Decrypts and parses the JSON
    4. Returns the `SchwabTokenPayload`
  - Import only from `node:crypto` (built-in)
- **Acceptance Criteria:**
  - [ ] File exports `encryptTokens` and `decryptTokens`
  - [ ] File exports `SchwabTokenPayload` type
  - [ ] Uses `node:crypto` only (no new npm dependencies)
  - [ ] Throws descriptive error if `SCHWAB_TOKEN_ENCRYPTION_KEY` is missing or wrong length
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** None

### Change 1.6: Create Schwab OAuth helper module
- **File:** `lib/schwab/auth.ts`
- **Action:** CREATE
- **Description:** Server-only module that handles Schwab OAuth URL generation, code exchange, and token refresh. Uses `@sudowealth/schwab-api` for the OAuth flow. Does NOT use `schwab-client-js` — we only need OAuth, not streaming, in the Next.js app.
- **New dependency:** `npm install @sudowealth/schwab-api`
- **What the file should contain:**
  - Import `createSchwabAuth` from `@sudowealth/schwab-api`
  - A function `getSchwabAuthConfig()` that reads `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_REDIRECT_URI` from env and throws if any are missing
  - A function `getSchwabAuthUrl(): { authUrl: string; state: string }` that:
    1. Creates a Schwab auth instance via `createSchwabAuth({ oauthConfig: getSchwabAuthConfig() })`
    2. Calls `getAuthorizationUrl()` and returns the result
  - A function `exchangeSchwabCode(code: string): Promise<SchwabTokenPayload>` that:
    1. Creates a Schwab auth instance
    2. Calls `exchangeCode(code)`
    3. Maps the response to a `SchwabTokenPayload` (access token expires in 30 min, refresh token expires in 7 days from now)
    4. Returns the token payload
  - A function `refreshSchwabToken(refreshToken: string): Promise<SchwabTokenPayload>` that:
    1. Creates a Schwab auth instance
    2. Calls `refresh(refreshToken)`
    3. Returns new token payload (new access token, SAME refresh token unless Schwab rotates it, recalculated expiry times)
- **Acceptance Criteria:**
  - [ ] File exports `getSchwabAuthUrl`, `exchangeSchwabCode`, `refreshSchwabToken`
  - [ ] Throws if env vars are missing
  - [ ] Does not expose any secrets in error messages
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Change 1.5 (imports SchwabTokenPayload type), npm install

### Change 1.7: Install `@sudowealth/schwab-api` dependency
- **Action:** Run command
- **Command:** `npm install @sudowealth/schwab-api`
- **Acceptance Criteria:**
  - [ ] Package appears in `package.json` dependencies
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** None (can run in parallel with other steps)

### Change 1.8: Create Schwab OAuth initiation API route
- **File:** `app/api/schwab/auth/route.ts`
- **Action:** CREATE
- **Description:** GET endpoint that generates a Schwab OAuth URL and redirects the user to Schwab's login page. Stores the OAuth `state` parameter in a short-lived httpOnly cookie for CSRF validation on callback. Protected by `requireUser()`.
- **What the file should contain:**
  - Import `requireUser` from `@/lib/server-db-utils`
  - Import `getSchwabAuthUrl` from `@/lib/schwab/auth`
  - Import `logRouteError` from `@/lib/api-route-utils`
  - A `GET` handler that:
    1. Calls `requireUser()` — return 401 if unauthorized
    2. Calls `getSchwabAuthUrl()` to get `authUrl` and `state`
    3. Creates a `Response.redirect(authUrl)` response
    4. Sets a cookie `schwab_oauth_state` with the `state` value: httpOnly, secure, sameSite=lax, path=/api/schwab/callback, maxAge=600 (10 minutes)
    5. Returns the redirect response
  - If Schwab env vars are not configured, return 503 with `{ error: 'Schwab integration not configured' }`
- **Acceptance Criteria:**
  - [ ] Route is protected by `requireUser()`
  - [ ] Sets httpOnly cookie with state parameter
  - [ ] Redirects to Schwab OAuth URL
  - [ ] Returns 503 if env vars missing
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Changes 1.5, 1.6

### Change 1.9: Create Schwab OAuth callback API route
- **File:** `app/api/schwab/callback/route.ts`
- **Action:** CREATE
- **Description:** GET endpoint that Schwab redirects to after user authorizes. Validates the state parameter, exchanges the authorization code for tokens, encrypts them, stores in the `schwabLinks` table, and redirects the user back to the Markets tab.
- **What the file should contain:**
  - Import `requireUser` from `@/lib/server-db-utils`
  - Import `exchangeSchwabCode` from `@/lib/schwab/auth`
  - Import `encryptTokens` from `@/lib/schwab/crypto`
  - Import `getDb` from `@/lib/db`
  - Import `schwabLinks` from `@/lib/db/schema`
  - Import `logRouteError` from `@/lib/api-route-utils`
  - A `GET` handler that:
    1. Calls `requireUser()` — return 401 if unauthorized
    2. Reads `code` and `state` from URL search params
    3. Reads `schwab_oauth_state` cookie from the request
    4. If `state` doesn't match the cookie value, return 400 `{ error: 'Invalid OAuth state — possible CSRF' }`
    5. If `code` is missing, return 400 `{ error: 'Missing authorization code' }`
    6. Calls `exchangeSchwabCode(code)` to get tokens
    7. Calls `encryptTokens(tokens)` to get encrypted blob + iv + tag
    8. Upserts into `schwabLinks` table:
       - id: `crypto.randomUUID()`
       - userId: the authenticated user's id
       - encryptedTokens: the encrypted hex string
       - tokenIv: the iv hex string
       - tokenTag: the tag hex string
       - status: 'active'
       - accessTokenExpiresAt: `new Date(tokens.expiresAt)`
       - refreshTokenExpiresAt: `new Date(tokens.refreshExpiresAt)`
       - updatedAt: `new Date()`
       - Use `onConflictDoUpdate` on `userId` unique constraint to update all token fields
    9. Clears the `schwab_oauth_state` cookie (set maxAge=0)
    10. Redirects to `/?tab=markets` (the main app with markets tab selected)
  - Wrap the whole thing in try/catch, log errors via `logRouteError`
- **Security notes:**
  - The `state` parameter CSRF check prevents an attacker from injecting their own authorization code
  - Tokens are encrypted before DB storage
  - Cookie is cleared after use
- **Acceptance Criteria:**
  - [ ] Route is protected by `requireUser()`
  - [ ] Validates `state` parameter against cookie
  - [ ] Exchanges code for tokens
  - [ ] Encrypts tokens before storage
  - [ ] Upserts into `schwabLinks` table
  - [ ] Redirects to `/?tab=markets` on success
  - [ ] Returns descriptive errors on failure
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Changes 1.2, 1.5, 1.6, 1.7

### Change 1.10: Create Schwab link status API route
- **File:** `app/api/schwab/status/route.ts`
- **Action:** CREATE
- **Description:** GET endpoint that returns the current user's Schwab link status (active/expired/none). Used by the frontend to show "LIVE" vs "DELAYED" badges and the "Link Schwab" button. Also supports DELETE to unlink (revoke) a Schwab connection.
- **What the file should contain:**
  - Import `requireUser` from `@/lib/server-db-utils`
  - Import `getDb` from `@/lib/db`
  - Import `schwabLinks` from `@/lib/db/schema`
  - Import `eq` from `drizzle-orm`
  - A `GET` handler that:
    1. Calls `requireUser()`
    2. Queries `schwabLinks` where `userId = user.id`, limit 1
    3. If no row, return `{ linked: false, status: null }`
    4. If row exists, check if `refreshTokenExpiresAt` is in the past:
       - If expired: update status to 'expired', return `{ linked: false, status: 'expired', expiredAt: row.refreshTokenExpiresAt }`
       - If active: return `{ linked: true, status: 'active', linkedAt: row.linkedAt, refreshExpiresAt: row.refreshTokenExpiresAt }`
  - A `DELETE` handler that:
    1. Calls `requireUser()`
    2. Deletes the row from `schwabLinks` where `userId = user.id`
    3. Returns `{ unlinked: true }`
- **Acceptance Criteria:**
  - [ ] GET returns link status without exposing any token data
  - [ ] GET auto-marks expired links
  - [ ] DELETE removes the link
  - [ ] Both methods protected by `requireUser()`
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Changes 1.2, 1.4

### Change 1.11: Update middleware to allow Schwab callback
- **File:** `middleware.ts`
- **Action:** No change needed
- **Description:** The current middleware matcher `['/((?!api|login|_next/static|_next/image|favicon.ico).*)']` already excludes all `/api/*` routes from the NextAuth middleware check. The Schwab callback at `/api/schwab/callback` will be accessible. The route itself calls `requireUser()` for auth. No change required.
- **Acceptance Criteria:**
  - [ ] Verified: `/api/schwab/*` routes are not blocked by middleware

---

## Phase 2: Streaming Relay Service

### Change 2.1: Create relay service directory and package.json
- **File:** `services/schwab-relay/package.json`
- **Action:** CREATE
- **Description:** Initialize a standalone Node.js project for the relay service. This is a separate deployable unit — NOT part of the Next.js build.
- **What the file should contain:**
  ```json
  {
    "name": "schwab-relay",
    "version": "1.0.0",
    "private": true,
    "type": "module",
    "scripts": {
      "start": "node dist/index.js",
      "build": "tsc",
      "dev": "tsx watch src/index.ts"
    },
    "dependencies": {
      "@neondatabase/serverless": "^1.0.2",
      "drizzle-orm": "^0.45.1",
      "ws": "^8.18.0",
      "dotenv": "^17.3.1"
    },
    "devDependencies": {
      "@types/node": "^20",
      "@types/ws": "^8.5.12",
      "tsx": "^4.19.0",
      "typescript": "5.9.3"
    }
  }
  ```
- **Why these deps:**
  - `@neondatabase/serverless` + `drizzle-orm` — same DB connection pattern as the main app
  - `ws` — WebSocket client for connecting to Schwab streaming (Node.js native WebSocket is not mature enough for production reconnection logic)
  - `dotenv` — load env vars from `.env` file during local dev
  - `tsx` — dev mode runner with TypeScript support and watch mode
- **Acceptance Criteria:**
  - [ ] File exists at `services/schwab-relay/package.json`
  - [ ] `cd services/schwab-relay && npm install` succeeds
- **Dependencies:** None

### Change 2.2: Create relay service tsconfig.json
- **File:** `services/schwab-relay/tsconfig.json`
- **Action:** CREATE
- **What the file should contain:**
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "outDir": "dist",
      "rootDir": "src",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "resolveJsonModule": true,
      "declaration": true,
      "sourceMap": true
    },
    "include": ["src/**/*.ts"],
    "exclude": ["node_modules", "dist"]
  }
  ```
- **Acceptance Criteria:**
  - [ ] File exists
  - [ ] `cd services/schwab-relay && npx tsc --noEmit` passes (after source files are created)
- **Dependencies:** None

### Change 2.3: Create relay service .env.example
- **File:** `services/schwab-relay/.env.example`
- **Action:** CREATE
- **What the file should contain:**
  ```
  # Neon PostgreSQL — same DATABASE_URL as the main app
  DATABASE_URL=
  
  # Schwab token encryption key — MUST match the main app's key
  SCHWAB_TOKEN_ENCRYPTION_KEY=
  
  # Schwab API credentials — same as main app
  SCHWAB_CLIENT_ID=
  SCHWAB_CLIENT_SECRET=
  
  # How often to refresh quotes from the DB token check (ms)
  TOKEN_CHECK_INTERVAL_MS=300000
  
  # Symbols to track (comma-separated)
  TRACK_EQUITIES=SPY,QQQ,DIA,IWM,AAPL,MSFT,AMZN,GOOGL,NVDA,TSLA,META,JPM,JNJ,V
  TRACK_FUTURES=/ES,/NQ,/YM,/RTY,/GC,/SI,/CL,/NG,/ZT,/ZN
  TRACK_FOREX=EUR/USD,GBP/USD,USD/JPY,USD/CAD,AUD/USD
  ```
- **Acceptance Criteria:**
  - [ ] File exists with all required env vars documented
- **Dependencies:** None

### Change 2.4: Create relay DB connection module
- **File:** `services/schwab-relay/src/db.ts`
- **Action:** CREATE
- **Description:** Simplified DB connection for the relay service. Uses the Neon HTTP client (reads/single writes). We do NOT import from the main app's `lib/db.ts` — the relay is a standalone service.
- **What the file should contain:**
  - Import `neon` from `@neondatabase/serverless`
  - Import `drizzle` from `drizzle-orm/neon-http`
  - A `getDb()` function that:
    1. Reads `DATABASE_URL` from env, throws if missing
    2. Creates a Neon HTTP client and Drizzle instance (no schema import — use raw SQL or re-define minimal schema)
    3. Caches the instance in a module-level variable
    4. Returns the Drizzle instance
  - **Important:** Since this is a standalone service, it cannot import from `@/*` paths. We need a minimal local schema definition or use raw SQL. The simplest approach: define minimal Drizzle table references locally that match the main app's schema for the two tables this service touches (`schwabLinks`, `realtimeQuotes`).
- **What the local schema should look like** (inline in this file or a separate `services/schwab-relay/src/schema.ts`):
  ```typescript
  // Minimal schema — just the tables the relay reads/writes
  import { pgTable, text, doublePrecision, timestamp, index, unique } from 'drizzle-orm/pg-core';
  
  export const schwabLinks = pgTable('schwab_links', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    encryptedTokens: text('encrypted_tokens').notNull(),
    tokenIv: text('token_iv').notNull(),
    tokenTag: text('token_tag').notNull(),
    status: text('status').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  });
  
  export const realtimeQuotes = pgTable('realtime_quotes', {
    symbol: text('symbol').primaryKey(),
    assetType: text('asset_type').notNull(),
    lastPrice: doublePrecision('last_price'),
    bidPrice: doublePrecision('bid_price'),
    askPrice: doublePrecision('ask_price'),
    openPrice: doublePrecision('open_price'),
    highPrice: doublePrecision('high_price'),
    lowPrice: doublePrecision('low_price'),
    closePrice: doublePrecision('close_price'),
    netChange: doublePrecision('net_change'),
    netChangePercent: doublePrecision('net_change_percent'),
    totalVolume: doublePrecision('total_volume'),
    exchangeId: text('exchange_id'),
    description: text('description'),
    securityStatus: text('security_status'),
    quoteTimeMs: doublePrecision('quote_time_ms'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  });
  ```
- **Acceptance Criteria:**
  - [ ] `getDb()` returns a working Drizzle instance
  - [ ] Local schema matches the main app's table structure for `schwab_links` and `realtime_quotes`
- **Dependencies:** Change 2.1

### Change 2.5: Create relay token management module
- **File:** `services/schwab-relay/src/tokens.ts`
- **Action:** CREATE
- **Description:** Handles reading Schwab tokens from the DB, decrypting them, refreshing access tokens when they're about to expire, and re-encrypting updated tokens back to the DB. This is a copy of the crypto logic from the main app (since we can't import across projects).
- **What the file should contain:**
  - AES-256-GCM encrypt/decrypt functions (same logic as `lib/schwab/crypto.ts` but standalone)
  - Type `SchwabTokenPayload` = `{ accessToken: string; refreshToken: string; expiresAt: string; refreshExpiresAt: string }`
  - A function `loadActiveTokens(db)` that:
    1. Queries `schwabLinks` where `status = 'active'`, limit 1
    2. If no row, returns `null`
    3. If `refreshTokenExpiresAt` is in the past, updates status to `'expired'`, returns `null`
    4. Decrypts the tokens
    5. If `accessTokenExpiresAt` is within 5 minutes of now, calls `refreshAccessToken()` (see below)
    6. Returns `{ userId, tokens: SchwabTokenPayload }`
  - A function `refreshAccessToken(db, row, decryptedTokens)` that:
    1. Makes a POST request to Schwab's token endpoint: `https://api.schwabapi.com/v1/oauth/token`
    2. Body: `grant_type=refresh_token&refresh_token=<token>`
    3. Authorization header: `Basic base64(clientId:clientSecret)` (read from env)
    4. Parses the response for new `access_token` and `expires_in`
    5. Encrypts the updated tokens
    6. Updates the `schwabLinks` row with new encrypted data and `accessTokenExpiresAt`
    7. Returns the new token payload
  - **Why we do token refresh here instead of using @sudowealth/schwab-api:** The relay service is standalone — importing @sudowealth/schwab-api would add unnecessary weight. The refresh endpoint is a simple POST. We implement it directly with `fetch()`.
- **Acceptance Criteria:**
  - [ ] `loadActiveTokens()` returns decrypted tokens or null
  - [ ] Auto-refreshes access token when within 5 min of expiry
  - [ ] Auto-marks link as expired when refresh token expires
  - [ ] Does not log any token values
  - [ ] Updates DB with re-encrypted new tokens after refresh
- **Dependencies:** Changes 2.1, 2.4

### Change 2.6: Create relay Schwab streaming client
- **File:** `services/schwab-relay/src/streamer.ts`
- **Action:** CREATE
- **Description:** The core streaming module. Connects to Schwab's WebSocket streaming API, authenticates, subscribes to L1 quotes and screener data, and emits parsed quote updates. Uses the `ws` npm package for the WebSocket connection.
- **Schwab streaming protocol overview** (so you understand what you're building):
  1. First, make a REST call to `https://api.schwabapi.com/trader/v1/userPreference` with the access token as Bearer auth. The response contains `streamerInfo` with `{ schwabClientCustomerId, schwabClientCorrelId, schwabClientChannel, schwabClientFunctionId }` and a `streamerSocketUrl`.
  2. Open a WebSocket to `streamerSocketUrl`.
  3. Send a LOGIN request as the first message:
     ```json
     {
       "requests": [{
         "service": "ADMIN",
         "command": "LOGIN",
         "requestid": "1",
         "SchwabClientCustomerId": "<from userPreference>",
         "SchwabClientCorrelId": "<from userPreference>",
         "parameters": {
           "Authorization": "<accessToken>",
           "SchwabClientChannel": "<from userPreference>",
           "SchwabClientFunctionId": "<from userPreference>"
         }
       }]
     }
     ```
  4. After LOGIN succeeds, send SUBS requests for each service you want.
  5. Messages arrive as JSON with `{ response: [...] }` for command responses and `{ data: [...] }` for streaming updates.
  6. Streaming data messages contain `{ service, timestamp, command: "SUBS", content: [{ key, 1: <bidPrice>, 2: <askPrice>, 3: <lastPrice>, ... }] }` where the numeric keys correspond to the field numbers documented above.
- **What the file should contain:**
  - Import `WebSocket` from `ws`
  - A class `SchwabStreamer` with:
    - Constructor takes `{ accessToken: string; onQuoteUpdate: (quotes: QuoteUpdate[]) => void; onScreenerUpdate: (data: ScreenerUpdate) => void; onError: (error: Error) => void; onDisconnect: () => void }`
    - Type `QuoteUpdate` = `{ symbol: string; assetType: string; lastPrice?: number; bidPrice?: number; askPrice?: number; openPrice?: number; highPrice?: number; lowPrice?: number; closePrice?: number; netChange?: number; netChangePercent?: number; totalVolume?: number; exchangeId?: string; securityStatus?: string; quoteTimeMs?: number }`
    - Type `ScreenerUpdate` = `{ type: 'gainers' | 'losers'; items: Array<{ symbol: string; lastPrice: number; netChange: number; netChangePercent: number; totalVolume: number }> }`
    - Method `async connect()`:
      1. Fetch user preferences from `https://api.schwabapi.com/trader/v1/userPreference` with Bearer token
      2. Extract `streamerInfo` and `streamerSocketUrl`
      3. Open WebSocket to `streamerSocketUrl`
      4. On open: send LOGIN request
      5. On LOGIN success: call `subscribe()`
    - Method `subscribe()`:
      1. Send SUBS for `LEVELONE_EQUITIES` with equity symbols (from env `TRACK_EQUITIES`), fields `0,1,2,3,8,10,11,12,17,18,28,8` (symbol, bid, ask, last, volume, high, low, close, open, netChange, netChangePercent, volume)
      2. Send SUBS for `LEVELONE_FUTURES` with futures symbols (from env `TRACK_FUTURES`), fields `0,1,2,3,4,5,8,12,13,14,18,19,20`
      3. Send SUBS for `LEVELONE_FOREX` with forex symbols (from env `TRACK_FOREX`), fields `0,1,2,3,6,10,11,12,15,16,17`
      4. Send SUBS for `SCREENER_EQUITY` with keys `$SPX.X_PERCENT_CHANGE_UP_0,$SPX.X_PERCENT_CHANGE_DOWN_0`, fields `0,1,2,3,4`
    - Method `handleMessage(rawData)`:
      1. Parse JSON
      2. If it contains `data` array, iterate each entry
      3. Map the numeric field keys to named fields based on the service type
      4. Call `onQuoteUpdate()` with mapped data for L1 services
      5. Call `onScreenerUpdate()` with mapped data for screener services
    - Method `disconnect()`: Close WebSocket, clean up
    - Method `isConnected()`: Check WebSocket readyState
    - Internal reconnection: on unexpected close, wait 5 seconds, then re-call `connect()`
    - Heartbeat: Schwab sends periodic heartbeat messages — log but ignore them
- **Field mapping reference** (embed as constants in the file):
  ```typescript
  // LEVELONE_EQUITIES field map
  const EQUITY_FIELDS = {
    0: 'symbol', 1: 'bidPrice', 2: 'askPrice', 3: 'lastPrice',
    8: 'totalVolume', 10: 'highPrice', 11: 'lowPrice', 12: 'closePrice',
    17: 'openPrice', 18: 'netChange', 28: 'netChangePercent',
  } as const;
  
  // LEVELONE_FUTURES field map
  const FUTURES_FIELDS = {
    0: 'symbol', 1: 'bidPrice', 2: 'askPrice', 3: 'lastPrice',
    8: 'totalVolume', 12: 'highPrice', 13: 'lowPrice', 14: 'closePrice',
    18: 'openPrice', 19: 'netChange', 20: 'netChangePercent',
  } as const;
  
  // LEVELONE_FOREX field map
  const FOREX_FIELDS = {
    0: 'symbol', 1: 'bidPrice', 2: 'askPrice', 3: 'lastPrice',
    6: 'totalVolume', 10: 'highPrice', 11: 'lowPrice', 12: 'closePrice',
    15: 'openPrice', 16: 'netChange', 17: 'netChangePercent',
  } as const;
  ```
- **Acceptance Criteria:**
  - [ ] `SchwabStreamer` class connects, authenticates, subscribes
  - [ ] Parses L1 and screener updates correctly
  - [ ] Reconnects automatically on disconnect (5s delay)
  - [ ] Does not log token values
  - [ ] Calls error/disconnect callbacks appropriately
- **Dependencies:** Change 2.1

### Change 2.7: Create relay quote writer module
- **File:** `services/schwab-relay/src/writer.ts`
- **Action:** CREATE
- **Description:** Receives parsed quote updates from the streamer and batch-upserts them into the `realtimeQuotes` table. Batches writes to avoid hammering the DB — collects updates for 1 second, then flushes.
- **What the file should contain:**
  - Import `getDb` from `./db`
  - Import `realtimeQuotes` from `./schema`
  - Import `sql` from `drizzle-orm`
  - A class `QuoteWriter` with:
    - A buffer: `Map<string, QuoteUpdate>` that accumulates updates
    - A flush interval (1000ms) that calls `flush()` periodically
    - Method `addQuote(quote: QuoteUpdate)`: Merges into buffer (latest wins for each symbol)
    - Method `async flush()`:
      1. If buffer is empty, return
      2. Take all entries from buffer, clear buffer
      3. For each entry, upsert into `realtimeQuotes` using `db.insert(...).values(...).onConflictDoUpdate({ target: realtimeQuotes.symbol, set: { ... all fields ..., updatedAt: new Date() } })`
      4. Batch upserts (process 50 at a time to avoid statement size limits)
      5. Log count of rows written
    - Method `addScreenerData(screenerUpdate)`:
      1. This is a special case — screener data comes as an array of top movers
      2. Store it in a module-level variable or a separate table row (we'll use the `marketSnapshots` table with snapshotType `'schwab_screener'`)
      3. Upsert the screener JSON into `marketSnapshots` with a short TTL
    - Method `stop()`: Clear the interval
- **Acceptance Criteria:**
  - [ ] Batches writes with 1s interval
  - [ ] Upserts correctly (no duplicate symbol errors)
  - [ ] Handles screener data separately
  - [ ] Logs write counts (not data values)
- **Dependencies:** Changes 2.1, 2.4

### Change 2.8: Create relay main entry point
- **File:** `services/schwab-relay/src/index.ts`
- **Action:** CREATE
- **Description:** The entry point that ties everything together. Loads tokens, starts the streamer, wires up the writer, and handles the lifecycle.
- **What the file should contain:**
  - Import `dotenv/config` (loads .env)
  - Import `loadActiveTokens` from `./tokens`
  - Import `SchwabStreamer` from `./streamer`
  - Import `QuoteWriter` from `./writer`
  - Import `getDb` from `./db`
  - Main flow:
    1. Log startup message with timestamp
    2. Call `loadActiveTokens(db)` — if null, log "No active Schwab link found. Waiting..." and start a polling loop (check every 5 minutes)
    3. When tokens are available:
       a. Create `QuoteWriter` instance
       b. Create `SchwabStreamer` instance with callbacks wired to the writer
       c. Call `streamer.connect()`
    4. Token refresh loop: every 5 minutes (`TOKEN_CHECK_INTERVAL_MS`), call `loadActiveTokens()` again. If the access token changed (was refreshed), reconnect the streamer with the new token.
    5. Handle `SIGINT` and `SIGTERM`: disconnect streamer, stop writer, exit gracefully.
    6. If streamer disconnects and tokens are still valid, the streamer's internal reconnect logic handles it. If tokens become expired, log a warning and stop the streamer.
  - **Market hours optimization (optional but recommended):** Only stream during market hours + extended (4am-8pm ET). During off-hours, disconnect and sleep, reconnecting at 3:55am ET. Use the `getEasternMarketSession`-style time check.
- **Acceptance Criteria:**
  - [ ] Starts up, loads tokens, connects to Schwab streaming
  - [ ] Writes quotes to DB via the writer
  - [ ] Handles graceful shutdown
  - [ ] Polls for token availability if none found initially
  - [ ] Refreshes tokens proactively
  - [ ] Logs lifecycle events (no secrets)
- **Dependencies:** Changes 2.4, 2.5, 2.6, 2.7

### Change 2.9: Create Fly.io deployment config
- **File:** `services/schwab-relay/fly.toml`
- **Action:** CREATE
- **Description:** Fly.io deployment configuration for the relay service. Uses a single shared-cpu-1x machine (the cheapest option at ~$3-5/mo).
- **What the file should contain:**
  ```toml
  app = "nexus-schwab-relay"
  primary_region = "iad"
  
  [build]
    [build.args]
  
  [env]
    NODE_ENV = "production"
  
  [[vm]]
    size = "shared-cpu-1x"
    memory = "256mb"
    auto_stop_machines = false
    auto_start_machines = true
  ```
- **Also create:** `services/schwab-relay/Dockerfile`
  ```dockerfile
  FROM node:20-slim AS build
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY tsconfig.json ./
  COPY src/ ./src/
  RUN npx tsc
  
  FROM node:20-slim
  WORKDIR /app
  COPY --from=build /app/dist ./dist
  COPY --from=build /app/node_modules ./node_modules
  COPY package.json ./
  CMD ["node", "dist/index.js"]
  ```
- **Acceptance Criteria:**
  - [ ] `fly.toml` and `Dockerfile` exist
  - [ ] `cd services/schwab-relay && docker build -t schwab-relay .` succeeds (if Docker available)
- **Dependencies:** All Phase 2 source files

### Change 2.10: Add .gitignore for relay service
- **File:** `services/schwab-relay/.gitignore`
- **Action:** CREATE
- **What the file should contain:**
  ```
  node_modules/
  dist/
  .env
  .env.local
  ```
- **Acceptance Criteria:**
  - [ ] File exists
  - [ ] node_modules and dist are ignored
- **Dependencies:** None

---

## Phase 3: Frontend Integration

### Change 3.1: Modify snapshot route to serve dual-source data
- **File:** `app/api/market-data/snapshot/route.ts`
- **Action:** MODIFY
- **Description:** Add logic to check if the requesting user has an active Schwab link. If yes, read from `realtimeQuotes` table instead of (or in addition to) the Massive API. If no, serve the existing Massive data as-is.
- **What to change in the `GET` handler:**
  1. After the `requireUser()` call succeeds and you have `auth.user`, add a new function call: `const schwabStatus = await getSchwabLinkStatus(db, auth.user.id)`
  2. Create a helper function `getSchwabLinkStatus(db, userId)` at the top of the file:
     ```typescript
     async function getSchwabLinkStatus(db: ReturnType<typeof getDb>, userId: string) {
       if (!db) return { active: false };
       try {
         const [link] = await db.select({ status: schwabLinks.status, refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt })
           .from(schwabLinks)
           .where(eq(schwabLinks.userId, userId))
           .limit(1);
         if (!link) return { active: false };
         if (link.status !== 'active') return { active: false };
         if (link.refreshTokenExpiresAt.getTime() < Date.now()) return { active: false };
         return { active: true };
       } catch {
         return { active: false };
       }
     }
     ```
  3. If `schwabStatus.active`, call a new function `fetchRealtimeSnapshot()` instead of `fetchFreshSnapshot()`:
     ```typescript
     async function fetchRealtimeSnapshot(db: NonNullable<ReturnType<typeof getDb>>): Promise<MarketSnapshotPayload & { dataSource: 'realtime' }> {
       // Read all quotes from realtimeQuotes table
       const quotes = await db.select().from(realtimeQuotes);
       
       // Build a lookup map by symbol
       const quoteLookup = new Map(quotes.map(q => [q.symbol, q]));
       
       // Map to the existing MarketInstrument format
       const mapQuote = (symbol: string, label: string): MarketInstrument => {
         const q = quoteLookup.get(symbol);
         if (!q) return { symbol, label, price: null, change: null, changePercent: null, marketStatus: null, quoteSession: 'snapshot', extendedQuoteUnavailable: false, extendedUnavailableLabel: null };
         return {
           symbol,
           label,
           price: q.lastPrice,
           change: q.netChange,
           changePercent: q.netChangePercent,
           marketStatus: q.securityStatus,
           quoteSession: 'regular', // Will be overridden below
           extendedQuoteUnavailable: false,
           extendedUnavailableLabel: null,
         };
       };
       
       // Read screener data from marketSnapshots (written by relay)
       let screenerGainers: MarketMoverRow[] = [];
       let screenerLosers: MarketMoverRow[] = [];
       try {
         const [screenerRow] = await db.select()
           .from(marketSnapshots)
           .where(eq(marketSnapshots.snapshotType, 'schwab_screener'))
           .limit(1);
         if (screenerRow) {
           const screenerData = screenerRow.dataJson as { gainers?: MarketMoverRow[]; losers?: MarketMoverRow[] };
           screenerGainers = screenerData.gainers ?? [];
           screenerLosers = screenerData.losers ?? [];
         }
       } catch { /* screener data optional */ }
       
       return {
         indices: INDEX_SYMBOLS.map(s => mapQuote(s, s)),
         futures: FUTURE_SYMBOLS.map(f => mapQuote(f.ticker.replace(/^\//, ''), f.label)),
         crypto: CRYPTO_SYMBOLS.map(c => mapQuote(c.symbol, c.symbol)),
         fx: FX_SYMBOLS.map(s => mapQuote(normalizeTicker(s), normalizeTicker(s))),
         equities: EQUITY_SYMBOLS.map(s => mapQuote(s, s)),
         movers: {
           gainers: screenerGainers,
           losers: screenerLosers,
         },
         dataSource: 'realtime',
       };
     }
     ```
  4. In the response JSON, add a `dataSource` field: `'realtime'` when using Schwab data, `'delayed'` when using Massive data.
  5. For the realtime path, skip the Massive cache read/write entirely — just read from `realtimeQuotes` and return.
  6. Add imports at the top: `import { schwabLinks, realtimeQuotes } from '@/lib/db/schema';`
- **Important edge case:** If Schwab data is stale (relay is down, `updatedAt` is old), fall back to Massive. Check if the newest `updatedAt` in `realtimeQuotes` is within 5 minutes. If not, fall back to Massive with a warning.
- **Acceptance Criteria:**
  - [ ] Users with active Schwab link get `dataSource: 'realtime'` in response
  - [ ] Users without Schwab link get `dataSource: 'delayed'` in response
  - [ ] Falls back to Massive if realtime data is stale (>5 min old)
  - [ ] Existing Massive flow is completely unchanged for non-Schwab users
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Changes 1.2, 1.3, Phase 2 (for data to exist)

### Change 3.2: Add Schwab link status hook
- **File:** `hooks/use-schwab-status.ts`
- **Action:** CREATE
- **Description:** Client-side hook that checks whether the current user has an active Schwab link. Polls the status endpoint once on mount. Used by MarketsTab to decide what badge to show.
- **What the file should contain:**
  ```typescript
  'use client';
  
  import { useCallback, useEffect, useState } from 'react';
  
  type SchwabLinkStatus = {
    linked: boolean;
    status: 'active' | 'expired' | null;
    refreshExpiresAt?: string;
  };
  
  export function useSchwabStatus() {
    const [schwabStatus, setSchwabStatus] = useState<SchwabLinkStatus>({ linked: false, status: null });
    const [loading, setLoading] = useState(true);
    
    const refresh = useCallback(async () => {
      try {
        const res = await fetch('/api/schwab/status');
        if (!res.ok) {
          setSchwabStatus({ linked: false, status: null });
          return;
        }
        const data = await res.json() as SchwabLinkStatus;
        setSchwabStatus(data);
      } catch {
        setSchwabStatus({ linked: false, status: null });
      } finally {
        setLoading(false);
      }
    }, []);
    
    useEffect(() => {
      void refresh();
    }, [refresh]);
    
    return { schwabStatus, loading, refresh };
  }
  ```
- **Acceptance Criteria:**
  - [ ] Returns `{ schwabStatus, loading, refresh }`
  - [ ] Fetches from `/api/schwab/status` on mount
  - [ ] Does not crash if the endpoint returns an error
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Change 1.10

### Change 3.3: Update MarketsTab to show data source and link button
- **File:** `components/trading/MarketsTab.tsx`
- **Action:** MODIFY
- **Description:** Add a "LIVE" or "15-MIN DELAYED" badge next to the Markets header, add a "Link Schwab Account" button for users who don't have Schwab linked, and show an "Unlink" option for those who do. Update the data banner to reflect the data source.
- **What to change:**
  1. Add import: `import { useSchwabStatus } from '@/hooks/use-schwab-status';`
  2. Inside `MarketsTab()`, add: `const { schwabStatus, loading: schwabLoading } = useSchwabStatus();`
  3. Update the snapshot response type to include `dataSource?: 'realtime' | 'delayed'`:
     ```typescript
     // In the loadSnapshot callback, update the response type:
     const payload = (await response.json()) as {
       data?: SnapshotPayload;
       fetchedAt?: string;
       warning?: string | null;
       stale?: boolean;
       coverage?: SnapshotCoverage;
       dataSource?: 'realtime' | 'delayed';
     };
     ```
  4. Add state: `const [dataSource, setDataSource] = useState<'realtime' | 'delayed' | null>(null);`
  5. In `loadSnapshot`, add: `setDataSource(payload.dataSource ?? 'delayed');`
  6. Replace the existing banner `<div className="rounded-xl border border-white/10 ...">` section with:
     ```tsx
     <div className="rounded-xl border border-white/10 bg-[#121214] px-4 py-3 text-sm text-zinc-400">
       <div className="flex items-center gap-2">
         {dataSource === 'realtime' ? (
           <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
             <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
             LIVE
           </span>
         ) : (
           <span className="inline-flex items-center rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-zinc-400">
             15-MIN DELAYED
           </span>
         )}
         <span className="text-xs text-zinc-500">
           {dataSource === 'realtime' ? 'Schwab real-time streaming' : 'Massive API delayed data'}
         </span>
       </div>
       {lastLoadedAt ? <p className="mt-1 text-xs text-zinc-500">Last update: {lastLoadedAt.toLocaleTimeString()}</p> : null}
       {coverage ? (
         <p className="mt-1 text-xs text-zinc-500">
           Coverage: {coverage.availablePrices}/{coverage.totalInstruments} symbols ({coverage.missingPriceCount} missing).
         </p>
       ) : null}
       {warning ? <p className="mt-2 text-xs text-amber-300">{warning}</p> : null}
       {isStale ? <p className="mt-1 text-xs text-amber-300">Data is stale (older than 30 minutes).</p> : null}
     </div>
     ```
  7. Add a Schwab link/unlink section below the banner (or in the header area):
     ```tsx
     {!schwabLoading && !schwabStatus.linked ? (
       <div className="rounded-xl border border-white/10 bg-[#121214] px-4 py-3">
         <div className="flex items-center justify-between">
           <div>
             <p className="text-sm font-medium text-zinc-200">Want real-time data?</p>
             <p className="text-xs text-zinc-400">Link your Schwab account for live streaming prices.</p>
           </div>
           <Button
             type="button"
             variant="outline"
             onClick={() => { window.location.href = '/api/schwab/auth'; }}
             className="border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10"
           >
             Link Schwab Account
           </Button>
         </div>
       </div>
     ) : null}
     {!schwabLoading && schwabStatus.linked ? (
       <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2">
         <div className="flex items-center justify-between">
           <p className="text-xs text-emerald-400">Schwab account linked — real-time data active</p>
           <button
             type="button"
             onClick={async () => {
               await fetch('/api/schwab/status', { method: 'DELETE' });
               window.location.reload();
             }}
             className="text-xs text-zinc-500 underline hover:text-zinc-300"
           >
             Unlink
           </button>
         </div>
         {schwabStatus.refreshExpiresAt ? (
           <p className="mt-1 text-[10px] text-zinc-500">
             Re-authorization needed by {new Date(schwabStatus.refreshExpiresAt).toLocaleDateString()}
           </p>
         ) : null}
       </div>
     ) : null}
     {!schwabLoading && schwabStatus.status === 'expired' ? (
       <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
         <div className="flex items-center justify-between">
           <div>
             <p className="text-sm font-medium text-amber-300">Schwab link expired</p>
             <p className="text-xs text-zinc-400">Your Schwab refresh token has expired (7-day limit). Re-link to restore real-time data.</p>
           </div>
           <Button
             type="button"
             variant="outline"
             onClick={() => { window.location.href = '/api/schwab/auth'; }}
             className="border-amber-500/30 bg-amber-500/10 px-3 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
           >
             Re-link Schwab
           </Button>
         </div>
       </div>
     ) : null}
     ```
  8. Update the polling interval: if `dataSource === 'realtime'`, poll every 5 seconds instead of 60 seconds (the data in the DB updates in near-real-time from the relay, so more frequent polling is appropriate):
     ```typescript
     useEffect(() => {
       const intervalMs = dataSource === 'realtime' ? 5_000 : 60_000;
       const interval = window.setInterval(() => {
         void loadSnapshot();
       }, intervalMs);
       return () => window.clearInterval(interval);
     }, [loadSnapshot, dataSource]);
     ```
- **Acceptance Criteria:**
  - [ ] Shows "LIVE" badge with green pulse dot when Schwab is active
  - [ ] Shows "15-MIN DELAYED" badge when using Massive
  - [ ] Shows "Link Schwab Account" button when not linked
  - [ ] Shows "Schwab account linked" with unlink option when linked
  - [ ] Shows expired warning with re-link button when token expired
  - [ ] Polls every 5s for realtime, 60s for delayed
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Changes 1.10, 3.1, 3.2

### Change 3.4: Support `?tab=markets` URL parameter
- **File:** `app/page.tsx`
- **Action:** MODIFY (minor)
- **Description:** After Schwab OAuth callback redirects to `/?tab=markets`, the app should open the Markets tab. Check if there's already URL param handling for tabs.
- **What to check first:** Read `app/page.tsx` to see if `activeTab` is initialized from URL params. If not, add:
  ```typescript
  // Inside NexusTerminal component, after useState declarations:
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['dashboard', 'performance', 'journal', 'trades', 'charts', 'markets', 'research', 'jarvis'].includes(tabParam)) {
      setActiveTab(tabParam as TabKey);
      // Clean the URL
      window.history.replaceState({}, '', '/');
    }
  }, []);
  ```
- **Only add this if the functionality doesn't already exist.**
- **Acceptance Criteria:**
  - [ ] Navigating to `/?tab=markets` opens the Markets tab
  - [ ] URL is cleaned after tab is set
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** None

---

## Phase 4: Scanner Foundation (Stub Only)

### Change 4.1: Scanner schema is already covered
- **No additional file changes needed.**
- **Description:** The `realtimeQuotes` table (Change 1.3) already contains all the fields needed for a basic scanner:
  - `symbol` — what to scan
  - `assetType` — filter by equity/etf/future/forex
  - `lastPrice` — current price
  - `netChangePercent` — % change filter
  - `totalVolume` — volume filter
  - `highPrice`, `lowPrice`, `openPrice`, `closePrice` — range filters
  - `updatedAt` — freshness check
- **Future scanner queries would look like:**
  ```sql
  -- Top gainers by % change (equities only, volume > 1M)
  SELECT * FROM realtime_quotes
  WHERE asset_type IN ('equity', 'etf')
    AND total_volume > 1000000
    AND updated_at > NOW() - INTERVAL '5 minutes'
  ORDER BY net_change_percent DESC
  LIMIT 50;
  
  -- High volume movers
  SELECT * FROM realtime_quotes
  WHERE asset_type IN ('equity', 'etf')
    AND total_volume > 5000000
    AND ABS(net_change_percent) > 2
    AND updated_at > NOW() - INTERVAL '5 minutes'
  ORDER BY total_volume DESC
  LIMIT 50;
  ```
- **When building the scanner UI (future sprint):** Create a `/api/scanner` route that accepts filter parameters and queries `realtimeQuotes` with those filters. The relay service will need to track more symbols (all of the S&P 500, NASDAQ 100, etc.) — expand `TRACK_EQUITIES` in the relay env config.
- **Acceptance Criteria:**
  - [ ] Documented: no additional schema changes needed for scanner foundation
  - [ ] `realtimeQuotes` table covers all scanner-relevant fields

---

## Files Affected

| File | Action | Risk Level |
|------|--------|------------|
| `.env.example` | MODIFY | LOW |
| `lib/db/schema.ts` | MODIFY | MEDIUM — adds 2 tables, no changes to existing |
| `lib/schwab/crypto.ts` | CREATE | MEDIUM — crypto code must be correct |
| `lib/schwab/auth.ts` | CREATE | HIGH — OAuth flow, token handling |
| `app/api/schwab/auth/route.ts` | CREATE | HIGH — OAuth initiation |
| `app/api/schwab/callback/route.ts` | CREATE | HIGH — OAuth callback, token storage |
| `app/api/schwab/status/route.ts` | CREATE | LOW |
| `app/api/market-data/snapshot/route.ts` | MODIFY | HIGH — core data flow change |
| `hooks/use-schwab-status.ts` | CREATE | LOW |
| `components/trading/MarketsTab.tsx` | MODIFY | MEDIUM — UI changes |
| `app/page.tsx` | MODIFY | LOW — URL param handling |
| `services/schwab-relay/` (all files) | CREATE | HIGH — new standalone service |
| `package.json` | MODIFY | LOW — one new dependency |

## Testing Requirements
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] Schwab OAuth flow: click "Link Schwab" -> redirected to Schwab -> authorize -> redirected back to Markets tab with "LIVE" badge
- [ ] Non-Schwab user sees "15-MIN DELAYED" badge and existing Massive data
- [ ] Schwab-linked user sees "LIVE" badge and data from `realtimeQuotes` table
- [ ] Unlinking Schwab reverts to delayed data
- [ ] Expired refresh token shows re-link prompt
- [ ] Relay service starts, connects to Schwab streaming, writes to DB
- [ ] Relay service reconnects after disconnect
- [ ] Relay service auto-refreshes access token before expiry
- [ ] `services/schwab-relay` builds with `npm run build`
- [ ] Encryption/decryption round-trips correctly (write a manual test)

## Security Considerations
1. **Token encryption:** All Schwab tokens encrypted at rest with AES-256-GCM. Encryption key in env var only.
2. **CSRF protection:** OAuth `state` parameter validated via httpOnly cookie.
3. **No token exposure:** Status endpoint returns boolean/dates only, never tokens.
4. **Relay service isolation:** Runs as separate process, writes to specific tables only.
5. **Client-side safety:** No Schwab credentials or tokens ever reach the browser.
6. **Env var discipline:** 5 new secrets (SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, SCHWAB_REDIRECT_URI, SCHWAB_TOKEN_ENCRYPTION_KEY, RELAY_SERVICE_SECRET) — all server-side only.
7. **Known risk:** Schwab refresh tokens expire after exactly 7 days. Users MUST re-authorize weekly. The UI surfaces this clearly.

## Rollback Plan
1. **Phase 1 rollback:** Drop `schwab_links` and `realtime_quotes` tables. Delete `lib/schwab/` directory and `app/api/schwab/` directory. Remove `@sudowealth/schwab-api` from package.json.
2. **Phase 2 rollback:** Stop and delete the Fly.io app. Delete `services/schwab-relay/` directory.
3. **Phase 3 rollback:** Revert `app/api/market-data/snapshot/route.ts` to its current state (git checkout). Remove `hooks/use-schwab-status.ts`. Revert `MarketsTab.tsx` changes.
4. **All phases are additive** — no existing functionality is removed or broken. Rollback is safe.

## Order of Operations
1. Install `@sudowealth/schwab-api` dependency (Change 1.7)
2. Add env vars to `.env.example` (Change 1.1)
3. Add `schwabLinks` and `realtimeQuotes` tables to schema (Changes 1.2, 1.3)
4. Run database migration (Change 1.4)
5. Create `lib/schwab/crypto.ts` (Change 1.5)
6. Create `lib/schwab/auth.ts` (Change 1.6)
7. Create `/api/schwab/auth` route (Change 1.8)
8. Create `/api/schwab/callback` route (Change 1.9)
9. Create `/api/schwab/status` route (Change 1.10)
10. Run `npm run lint && npx tsc --noEmit` — verify Phase 1
11. Create relay service directory structure (Changes 2.1, 2.2, 2.3, 2.10)
12. Create relay source files (Changes 2.4, 2.5, 2.6, 2.7, 2.8)
13. Create relay deployment config (Change 2.9)
14. Run `cd services/schwab-relay && npm install && npx tsc --noEmit` — verify Phase 2
15. Modify snapshot route for dual-source (Change 3.1)
16. Create `use-schwab-status` hook (Change 3.2)
17. Update MarketsTab (Change 3.3)
18. Add tab URL param support (Change 3.4)
19. Run `npm run lint && npx tsc --noEmit` — verify Phase 3
20. Deploy relay to Fly.io, test end-to-end

## Complexity Estimate
**HIGH** — 8+ hours across all phases.
- Phase 1 (OAuth): ~3 hours (7 file changes, crypto + OAuth flow)
- Phase 2 (Relay): ~3 hours (6 files, new standalone service with WebSocket)
- Phase 3 (Frontend): ~2 hours (4 file changes, UI + API integration)
- Phase 4 (Scanner stub): ~0 hours (documentation only)

Rationale: Multiple new auth surfaces, a new standalone service, WebSocket protocol implementation, encrypted token management, and frontend integration across multiple components. Each phase can be done independently but the full feature requires all three.
