# Nexus Terminal

Trading journal, analytics platform, and AI-assisted research tool built with Next.js, React, and TypeScript.

## What It Does

- Tracks and journals trades with execution-level detail
- Imports broker CSV data (single files or folder batches)
- Performance analytics, replay charts, and market snapshots
- Tagging, filtering, and bulk trade actions
- **Jarvis AI** — chat, trade analysis, macro summaries, and dilution research reports
- **Jarvis chat streaming** — token-by-token assistant responses over SSE with fallback to non-streaming commands
- **Dilution research terminal** — full-page Research workspace with AskEdgar top gainers, live ticker lookup, chart, tabbed filing sections (including ownership + gap stats), and optional Jarvis TLDR
- **Discord report import** — backfill/sync research reports into `imported_research_reports` with parsed ticker metadata

## Core Product Areas

- **Dashboard** — account-level performance overview
- **Journal** — daily trade breakdowns + replay charts
- **Performance** — analytics charts and statistics
- **Trades** — trade management, bulk actions, tag filters
- **Charts** — expanded charting workspace
- **Markets** — snapshot + movers + scanner + macro summary
- **Research** — full-page dilution terminal (gainers, chart, risk header, AskEdgar sections, Jarvis TLDR)
- **Backtesting** — Jarvis chat workspace
- **Real-time market data relay** — Schwab live-data hybrid integration (Phases 1-3 complete: OAuth + relay + LIVE/DELAYED frontend switching)
- **Relay ticker auto-subscribe** — Schwab relay loads distinct imported research tickers and subscribes them at startup (non-fatal if unavailable)

## Tech Stack

- Next.js 15 (App Router)
- React 19
- TypeScript 5.9
- Tailwind CSS v4
- Drizzle ORM + PostgreSQL (Neon)
- NextAuth v5 (Google OAuth)
- Recharts + lightweight-charts
- Vitest test runner (`npm test`)

## Jarvis AI Pipeline

Jarvis is the AI layer powering chat, trade analysis, and research reports.

- **LLM provider**: Groq (OpenAI-compatible API, free tier available)
- **Model**: `llama-3.3-70b-versatile` (configurable via `JARVIS_MODEL`)
- **Research flow**: AskEdgar API (15 direct research endpoints in the ticker lookup flow) powers direct UI data; optional TLDR endpoint uses Jarvis with AskEdgar + Discord historical summary context
- **Safety**: circuit breaker, per-user rate limiting (30 req/hr), request logging

## Data + Auth Model

- Cloud mode: PostgreSQL via API routes
- Fallback mode: localStorage when database is unavailable
- Protected app routes via middleware and server-side auth helpers

## Key Environment Variables

See `.env.example` for the full list.

- `DATABASE_URL` — PostgreSQL connection string (Neon)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` — NextAuth config
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth provider
- `JARVIS_API_KEY` — LLM provider API key (Groq)
- `JARVIS_API_BASE_URL` — LLM endpoint (default: Groq)
- `JARVIS_MODEL` — LLM model ID
- `ASKEDGAR_API_KEY` — AskEdgar API for dilution research
- `MASSIVE_API_KEY` — Market data provider
- `DISCORD_BOT_TOKEN` — Discord bot token for research report import routes
- `DISCORD_CHANNEL_ID` — Discord channel containing research report messages

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
lib/jarvis/          # Jarvis AI pipeline (client, prompts, research, etc.)
drizzle/             # SQL migrations
__tests__/           # Route, utility, and component test coverage
services/schwab-relay/ # Standalone Schwab streaming relay service
```
