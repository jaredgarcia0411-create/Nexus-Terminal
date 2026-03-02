# Nexus Terminal
## What It Does
### Nexus Terminal is a web-based trading dashboard that lets you import trade data, analyze performance metrics, and connect directly to brokerage APIs for live market access. It integrates AI-powered analysis via Google Gemini to help surface patterns in your trading history.
Core Features

- Trade Journal — Import and organize trades from CSV files with automatic date parsing and sorting.
- Charles Schwab Integration — OAuth 2.0 connection to Schwab's API for live market data and account access.
- Google OAuth — Secure authentication via Google for user sessions (JWT-based).
- AI Analysis — Gemini API integration for contextual trade analysis and strategy evaluation.
- Backtesting — Historical data search and strategy testing tools.
- File Context Upload — Attach CSV, JSON, or TXT files to enrich AI analysis with your strategy parameters.

### Tech Stack

Framework: Next.js 15 (App Router)
Language: TypeScript
UI: React 19, Tailwind CSS 4, Framer Motion, Recharts, Lucide icons
Auth: Google OAuth 2.0 + JWT sessions (via jose)
Brokerage: Charles Schwab OAuth 2.0 API
AI: Google Gemini (@google/genai)
Data: PapaParse (CSV parsing)
Deployment: Vercel

# Still in testing

- Adding Broker Sync to auto sync executions if preferred
- Adding multiple broker CSV formats for parsing
- Updating to handle broken CSV parses &/or notify when file name formatted improperly
- Building out Backtesting Simulation Logic based on Charles Schwab Market Data API.
- Final goal is to have small dedicated server to run backtests with virtually 0 bottlenck, as well as possibility of connecting an agent to it's own RAG & train it on your system(s).
