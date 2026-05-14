# Nexus Terminal

Trading journal, analytics platform, and dilution research tool built for a small group of small-cap short sellers.

## What It Does

- **Trade journaling** — logs executions with risk, MFE/MAE, grade, setup, errors, and agenda fields
- **Broker imports** — CSV imports (single file, folder batch, or TraderVue), normalized into the trades schema
- **Performance analytics** — equity curves, daily/weekly stats, career P/L, replay charts
- **Tagging, filtering, bulk actions** — tag presets, multi-select tags, bulk apply/delete
- **Dilution research terminal** — TradingView gainers, live ticker lookup, chart, AskEdgar filing/ownership/gap sections, optional LLM-generated TLDR
- **Backtesting workspace** — replay sessions, sample sets, chart review, simulated trades
- **Archive** — saved daily and weekly review records with journal context
- **Background agents** — Docker Compose services (Orchestrator, Small Cap Trader, Swing Trader) that run pre-market scans and dilution research, with results published to Discord

## Core Product Areas

Top-level tabs in the app (see `app/page.tsx`):

- **Dashboard** — account-level performance overview and quick links into Research
- **Management** — sub-tabs for Journal, Trades, Performance, Career P/L, and Archive
- **Charts** — full-screen replay/backtesting workspace
- **Research** — full-page dilution terminal (gainers, chart, risk header, AskEdgar sections, optional TLDR)

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript 5.9
- **Styling:** Tailwind CSS v4 + shadcn/Radix UI
- **Database:** PostgreSQL (Neon) via Drizzle ORM
- **Auth:** NextAuth v5 (Google OAuth)
- **Charts:** Recharts (performance) + lightweight-charts (price/replay)
- **Tests:** Vitest
- **Deploy:** Vercel (web app) + Docker Compose on a home server (agents)
- **External APIs:** AskEdgar (filings/dilution), Massive API (market data), Together AI (background LLM), Groq-compatible endpoint (research TLDR), TradingView (gainers)
