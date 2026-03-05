# Nexus Terminal

Nexus Terminal is a focused trading journal built with Next.js 15, React 19, and TypeScript. It is designed to stay lean: trade logging, analytics, filtering, and an AI assistant (Jarvis) without broker lock-in or bundled backtesting services.

## Current Product Scope

- Trade journal with CSV import and execution-level persistence
- Tagging, search, date filtering, and bulk operations
- Dashboard + performance analytics views
- Candlestick visualizations with execution overlays
- Jarvis assistant tab for:
  - daily summaries
  - trade analysis
  - on-demand help
  - optional single-page web scraping context

## Tech Stack

- Framework: Next.js 15 (App Router), React 19, TypeScript 5.9
- Styling: Tailwind CSS v4 + Motion (`motion/react`)
- Auth: NextAuth v5 (Google provider)
- Data: Drizzle ORM + PostgreSQL (Neon). Falls back to localStorage when DB is unavailable.
- Charts: Recharts + lightweight-charts

## Key UX Notes

- Desktop sidebar shows icon + page labels.
- Time presets (`All`, `30D`, `60D`, `90D`) are global in the top header.
- Journal day cards now include medium per-trade replay charts with execution markers.
- Journal trade replay charts load progressively in batches for better performance on heavy days.
- Trade tables with more than 20 rows become vertically scrollable.

## Jarvis LLM Configuration (GLM-4.7)

Jarvis uses a configurable chat-completions provider and defaults to GLM-4.7.

Required/optional environment variables:

- `JARVIS_API_KEY` (optional, required for live LLM responses)
- `JARVIS_API_BASE_URL` (default: `https://open.bigmodel.cn/api/paas/v4/chat/completions`)
- `JARVIS_MODEL` (default: `glm-4.7`)

If no key is configured, Jarvis still returns deterministic fallback summaries and analysis.

## Environment Variables

See `.env.example` for the current canonical list.

Important variables:

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DATABASE_URL` (optional)
- `TRADE_WEBHOOK_SECRET`
- `CRON_SECRET`
- `JARVIS_API_KEY` / `JARVIS_API_BASE_URL` / `JARVIS_MODEL`

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Validation Commands

```bash
npm test
npm run build
```

## Project Layout (High-Level)

```text
app/
  page.tsx
  api/
    jarvis/route.ts
    market-data/route.ts
    trades/
    tags/
    discord/
    cron/

components/trading/
  Sidebar.tsx
  Toolbar.tsx
  JournalTab.tsx
  JournalTradeChart.tsx
  TradeDetailSheet.tsx
  JarvisTab.tsx

hooks/
  use-trades.ts
  use-candle-data.ts

lib/
  db/
  csv-parser.ts
  price-alert-evaluator.ts
  service-*.ts
```
