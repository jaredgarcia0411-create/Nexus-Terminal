# Nexus Terminal

Nexus Terminal is a professional trading terminal and analytics platform.

Primary goals:
- track trades
- analyze performance
- integrate broker APIs
- visualize market data
- support algorithmic trading tools

Target users:
- discretionary traders
- quantitative traders
- performance analysts

The application is built as a modern SaaS web platform with a modular architecture designed for rapid iteration and AI-assisted development.

# System Architecture

The project follows a modular architecture.

Core layers:

Frontend
- React
- UI components
- data visualization
- trade journal interface

Backend
- Node / TypeScript API layer
- handles broker integrations
- authentication
- data processing

Database
- PostgreSQL via Neon
- managed with Drizzle ORM

Services
- Market data services
- Broker API connectors
- analytics services

Agents
- Claude Code agents generate architecture and planning
- Codex agents execute implementation tasks

# Technology Stack

Frontend
- React
- Vite
- TypeScript

Backend
- Node.js
- Express

Database
- PostgreSQL (Neon)
- Drizzle ORM

Visualization
- Recharts

APIs
- Charles Schwab API
- OAuth 2.0

Development Environment
- WSL
- GitHub
- Node 20+

# Development Rules

When making changes:

1. Preserve existing architecture.
2. Avoid large refactors unless explicitly requested.
3. Always run linting and tests after modifying code.
4. Prefer modular code.
5. Avoid unnecessary dependencies.
6. Maintain TypeScript typing.

# Security Rules

Never modify or expose:

.env
.env.local
API keys
OAuth secrets
database credentials

Secrets must always be accessed via environment variables.

Do not log sensitive data.
Do not commit secrets to Git.

# Agent Workflow

Claude Code responsibilities:

- architecture planning
- writing specifications
- designing agents
- creating Codex prompts

Codex responsibilities:

- implementing code
- fixing lint errors
- writing tests
- running migrations

Workflow:

1. Claude designs solution.
2. Claude writes Codex execution prompt.
3. Codex performs implementation.
4. Codex runs tests.
5. Claude reviews architecture integrity.

# Project Roadmap

Phase 1
- trading journal
- trade analytics
- local persistence

Phase 2
- broker API integration
- OAuth authentication
- market data ingestion

Phase 3
- strategy analytics
- AI trade analysis
- performance dashboards

Phase 4
- SaaS deployment
- user accounts
- multi-device sync

# AI Development Guidelines

Before implementing features:

1. analyze the existing architecture
2. avoid introducing breaking changes
3. ensure code remains maintainable
4. prioritize clarity over complexity
5. confirm database schema compatibility
