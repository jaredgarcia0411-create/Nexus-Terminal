# Nexus Terminal

Trading journal, analytics platform, and research tool built with Next.js, React, and TypeScript.

## What It Does

- Tracks and journals trades with execution-level detail
- Imports broker CSV data (single files or folder batches)
- Performance analytics, replay charts, and charting tools
- Tagging, filtering, and bulk trade actions
- **Dilution research terminal** — full-page Research workspace with TradingView top gainers, live ticker lookup, chart, tabbed filing sections (including ownership + gap stats), and optional TLDR generation
- **Discord report import** — backfill/sync research reports into `imported_research_reports` with parsed ticker metadata

## Core Product Areas

- **Dashboard** — account-level performance overview
- **Journal** — daily trade breakdowns + replay charts
- **Performance** — analytics charts and statistics
- **Trades** — trade management, bulk actions, tag filters
- **Charts** — expanded charting workspace
- **Research** — full-page dilution terminal (TradingView gainers, chart, risk header, AskEdgar sections, optional TLDR)

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
- **Model**: `llama-3.3-70b-versatile` by default (configurable via `JARVIS_MODEL`)
- **Research flow**: AskEdgar API powers the structured research UI; the optional TLDR endpoint combines AskEdgar data with Discord historical summary context

## Data + Auth Model

- Cloud mode: PostgreSQL via API routes
- Fallback mode: localStorage when database is unavailable
- Protected app routes via middleware and server-side auth helpers

## Key Environment Variables

See `.env.example` for the full list.

- `DATABASE_URL` — PostgreSQL connection string (Neon)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` — NextAuth config
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth provider
- `JARVIS_API_KEY` — LLM provider API key for research TLDR generation
- `JARVIS_API_BASE_URL` — LLM endpoint override
- `JARVIS_MODEL` — LLM model ID
- `TRADINGVIEW_SESSION_ID` — enables live TradingView screener data for Research gainers (optional)
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
drizzle/             # SQL migrations
__tests__/           # Route, utility, and component test coverage
```
