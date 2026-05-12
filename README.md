# Nexus Terminal

Trading journal, analytics platform, and research tool built with Next.js, React, and TypeScript.

## What It Does

- Tracks and journals trades with execution-level detail
- Imports broker CSV data (single files or folder batches)
- Performance analytics, replay charts, and charting tools
- Tagging, filtering, and bulk trade actions
- **Dilution research terminal** — full-page Research workspace with TradingView top gainers, live ticker lookup, chart, tabbed filing sections (including ownership + gap stats), and optional TLDR generation
- **Backtesting workspace** — replay sessions, sample sets, review mode, and stats views
- **Archive** — daily and weekly review history with saved journal context

## Core Product Areas

- **Dashboard** — account-level performance overview
- **Journal** — daily trade breakdowns + replay charts
- **Performance** — analytics charts and statistics
- **Trades** — trade management, bulk actions, tag filters
- **Charts** — expanded charting workspace
- **Research** — full-page dilution terminal (TradingView gainers, chart, risk header, AskEdgar sections, optional TLDR)
- **Backtesting** — replay manager, sample sets, chart review, and trade simulation tools
- **Archive** — daily and weekly review records

## Tech Stack

- Next.js 15 (App Router)
- React 19
- TypeScript 5.9
- Tailwind CSS v4
- Drizzle ORM + PostgreSQL (Neon)
- NextAuth v5 (Google OAuth)
- Recharts + lightweight-charts
- Vitest test runner (`npm test`)

## Research TLDR Pipeline

- **LLM provider**: Groq-compatible OpenAI chat completion API
- **Model**: `llama-3.3-70b-versatile` by default (configurable via `LLM_MODEL`)
- **Research flow**: AskEdgar API powers the structured research UI; the optional TLDR endpoint summarizes the current AskEdgar snapshot/raw data

## Data + Auth Model

- Cloud mode: PostgreSQL via API routes
- Fallback mode: localStorage when database is unavailable
- Protected app routes via middleware and server-side auth helpers

## Key Environment Variables

See `.env.example` for the full list.

- `DATABASE_URL` — PostgreSQL connection string (Neon)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` — NextAuth config
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth provider
- `LLM_API_KEY` — LLM provider API key for research TLDR generation
- `LLM_API_BASE_URL` — LLM endpoint override for TLDR generation
- `LLM_MODEL` — TLDR model ID
- `BACKGROUND_LLM_API_KEY` — paid background LLM key for site research reports and agent work
- `BACKGROUND_LLM_API_BASE_URL` — background LLM endpoint override
- `BACKGROUND_LLM_MODEL` — background research report model ID
- `BACKGROUND_LLM_TIMEOUT_MS` — background LLM timeout in milliseconds
- `CRON_SECRET` — shared secret for cron-protected endpoints
- `TRADINGVIEW_SESSION_ID` — enables live TradingView screener data for Research gainers (optional)
- `ASKEDGAR_API_KEY` — AskEdgar API for dilution research
- `MASSIVE_API_KEY` — Market data provider

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
