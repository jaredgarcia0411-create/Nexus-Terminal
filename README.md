# Nexus Terminal

Trading journal, analytics platform, and AI-assisted research tool built with Next.js, React, and TypeScript.

## What It Does

- Tracks and journals trades with execution-level detail
- Imports broker CSV data (single files or folder batches)
- Performance analytics, replay charts, and market snapshots
- Tagging, filtering, and bulk trade actions
- **Jarvis AI** — chat, trade analysis, macro summaries, and dilution research reports
- **Dilution research** — pulls SEC filing data via AskEdgar API, runs it through an LLM, and renders structured risk reports

## Core Product Areas

- **Dashboard** — account-level performance overview
- **Journal** — daily trade breakdowns + replay charts
- **Performance** — analytics charts and statistics
- **Trades** — trade management, bulk actions, tag filters
- **Charts** — expanded charting workspace
- **Markets** — snapshot + movers + macro summary
- **Research** — AI-generated dilution reports, daily summaries, saved tickers
- **Backtesting** — Jarvis chat workspace

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
- **Research flow**: AskEdgar API (13 SEC endpoints) → token-trimmed payload → LLM → structured JSON report → rendered UI
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
```
