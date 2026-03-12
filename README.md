# Nexus Terminal

Nexus Terminal is a SaaS trading journal and analytics platform built with Next.js, React, and TypeScript.

## What It Does

- Tracks and journals trades with execution-level detail
- Imports broker CSV data (single files or folder batches)
- Provides performance analytics, replay charts, and market snapshots
- Supports tagging, filtering, and bulk trade actions
- Includes Jarvis-assisted workflows for markets, research, and backtesting

## Core Product Areas

- `Dashboard` - account-level performance overview
- `Journal` - daily trade breakdowns + replay charts
- `Performance` - analytics charts and statistics
- `Trades` - trade management, bulk actions, tag filters
- `Charts` - expanded charting workspace
- `Markets` - snapshot + movers + macro summary
- `Research` - AI reports, daily summaries, saved tickers
- `Backtesting` - Jarvis chat workspace

## Tech Stack

- Next.js 15 (App Router)
- React 19
- TypeScript 5.9
- Tailwind CSS v4
- Drizzle ORM + PostgreSQL (Neon)
- NextAuth v5 (Google OAuth)
- Recharts + lightweight-charts
- Vitest test runner (`npm test`)

## Data + Auth Model

- Cloud mode: PostgreSQL via API routes
- Fallback mode: localStorage when database is unavailable
- Protected app routes via middleware and server-side auth helpers

## Key Environment Variables

See `.env.example` for the full list.

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `MASSIVE_API_KEY`
- `JARVIS_API_KEY` (or `NVIDIA_API_KEY`)
- `JARVIS_API_BASE_URL`
- `JARVIS_MODEL`

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Validation Commands

```bash
npm run lint
npx tsc --noEmit
npm test
```

## Project Structure (High-Level)

```text
app/                 # App router pages + API routes
components/trading/  # Trading feature UI components
hooks/               # Client-side hooks (including trade state)
lib/                 # Services, utilities, db schema, auth config
drizzle/             # SQL migrations
__tests__/           # Route, utility, and component test coverage
```
