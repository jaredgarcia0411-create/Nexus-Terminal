# TECHSTACK

Last updated: 2026-03-07

## Overview

Nexus Terminal is a trading journal web app built with Next.js App Router, React, and TypeScript. It stores data in PostgreSQL via Drizzle ORM when `DATABASE_URL` is configured, and supports localStorage fallback behavior in client flows when DB access is unavailable.

## Core Stack

- Framework: Next.js `^15.4.9` (App Router)
- UI: React `^19.2.1`, React DOM `^19.2.1`
- Language: TypeScript `5.9.3`
- Styling: Tailwind CSS `4.1.11`, PostCSS, `tw-animate-css`
- Animation: `motion` `^12.23.24`
- Forms and validation: `react-hook-form`, `@hookform/resolvers`, `zod`
- Charts: `recharts`, `lightweight-charts`
- UI utilities: `clsx`, `class-variance-authority`, `tailwind-merge`, `radix-ui`, `cmdk`, `lucide-react`, `sonner`
- CSV parsing: `papaparse`

## Authentication

- Auth library: NextAuth v5 beta (`next-auth@^5.0.0-beta.30`)
- Current provider in runtime config: Google OAuth (`lib/auth-config.ts`)
- Session strategy: JWT
- Login page: `/login`
- Protected route behavior:
  - middleware exports `auth` from `lib/auth-config.ts`
  - matcher excludes `/api/*`, `/login`, and Next static/image routes

## Data Layer

- Database: PostgreSQL (Neon serverless drivers)
- ORM: Drizzle ORM + Drizzle Kit
- Drizzle schema source: `lib/db/schema.ts`
- Drizzle config: `drizzle.config.ts`
  - reads `.env.local`
  - `schema: ./lib/db/schema.ts`
  - `out: ./drizzle`
- DB clients in `lib/db.ts`:
  - `getDb()` -> HTTP client for reads and single-statement writes
  - `getPoolDb()` -> pooled client for transactional/bulk operations

## Database Schema

The current schema source of truth is `lib/db/schema.ts`.

### users
- `id` text primary key
- `email` text unique not null
- `name` text nullable
- `picture` text nullable
- `created_at` timestamptz default now

### trades
- composite primary key: (`user_id`, `id`)
- trade fields: symbol, direction, avg prices, quantity, pnl fields, timestamps, notes
- compatibility fields retained: `pnl`, `executions`
- foreign key: `user_id -> users.id` (cascade delete)
- index: `idx_trades_user_sort_key (user_id, sort_key)`

### trade_executions
- `id` text primary key
- fields: side, price, qty, time, timestamp, commission, fees, created_at
- foreign key: (`user_id`, `trade_id`) -> `trades(user_id, id)` (cascade delete)
- index: `idx_executions_user_trade (user_id, trade_id)`

### trade_tags
- composite primary key: (`user_id`, `trade_id`, `tag`)
- foreign key: (`user_id`, `trade_id`) -> `trades(user_id, id)` (cascade delete)
- index: `idx_trade_tags_user_trade_id (user_id, trade_id)`

### tags
- `id` serial primary key
- unique: (`user_id`, `name`)
- foreign key: `user_id -> users.id` (cascade delete)
- index: `idx_tags_user_id (user_id)`

### broker_sync_log
- `id` serial primary key
- foreign key: `user_id -> users.id`
- fields: broker, account_number, sync_start, sync_end, trades_synced, synced_at

### jarvis_source_urls
- composite primary key: (`user_id`, `url`)
- foreign key: `user_id -> users.id`
- fields: use_count, created_at, last_used_at
- index: `idx_jarvis_source_urls_user_last_used (user_id, last_used_at)`

### Legacy integration tables removed
- Discord/notification/service-token tables are removed from schema source in the current code.
- Migration `drizzle/0003_smiling_agent_zero.sql` drops those tables in existing databases.

## Migrations

- `drizzle/0000_motionless_catseye.sql`
  - baseline schema creation
- `drizzle/0001_nosy_nebula.sql`
  - converts `user_id` columns from `uuid` to `text`
  - adds `users.name`
- migration journal: `drizzle/meta/_journal.json`

## Environment Variables

From `.env.example` and project usage:

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DATABASE_URL`
- `JARVIS_API_KEY`
- `JARVIS_API_BASE_URL`
- `JARVIS_MODEL`
- `NVIDIA_API_KEY`
- `ALLOWED_EMAILS`

## Tooling

- Lint: `npm run lint`
- Test: `npm test` (Vitest)
- Build: `npm run build`
- Drizzle commands:
  - `npm run db:generate`
  - `npm run db:migrate`
  - `npm run db:push`
  - `npm run db:studio`
