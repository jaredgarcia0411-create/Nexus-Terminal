# Simplify Nexus Terminal

## Core judgment

Nexus Terminal is carrying too much system architecture for its actual job.

The project currently behaves like three products layered together:

1. a trading journal and market dashboard
2. an internal AI/research assistant
3. a future multi-agent platform

That is the main source of bloat.

The problem is not that the code is careless. The problem is that too much infrastructure is being built before the simpler version has been fully exhausted.

For a private tool used by a solo founder and a small group, the default target should be:

- one main app
- one database
- one special realtime service only if it is truly necessary
- one lightweight background job system only when request/response is no longer enough

The current codebase exceeds that target in several places.

---

## What is real complexity vs self-inflicted complexity

### Real complexity required by the product

These are justified:

- authenticated API routes
- persistent Postgres-backed storage
- broker CSV import and trade normalization
- one reliable live quote path
- one historical market data source for candles/context
- one cache for expensive research providers like AskEdgar
- a small amount of prompt/context assembly for the assistant

### Self-inflicted complexity

These are the main sources of bloat:

- multiple live market delivery paths for the same data
- Jarvis built like a platform instead of a feature
- raw research payload normalization pushed into the UI
- permanent local-storage and cloud dual-runtime behavior
- speculative memory, telemetry, admin, and orchestration systems
- a large multi-agent architecture spec far ahead of demonstrated need

---

## Evidence-backed hotspots

### 1) Jarvis is overbuilt for an internal assistant

Key files:

- `app/api/jarvis/chat/route.ts`
- `app/api/jarvis/chat/stream/route.ts`
- `lib/jarvis/circuit-breaker.ts`
- `lib/jarvis/token-tracking.ts`
- `app/api/jarvis/admin/stats/route.ts`

Why this is bloated:

- separate chat and stream routes
- custom circuit breaker logic
- token/cost tracking infrastructure
- admin stats and memory surfaces

This is infrastructure complexity that fits a multi-tenant AI product more than a small internal trading tool.

### 2) Market data has too many overlapping delivery layers

Key files:

- `hooks/use-relay-socket.ts`
- `hooks/use-market-stream.ts`
- `app/api/market-data/stream/route.ts`
- `app/api/market-data/snapshot/route.ts`
- `services/schwab-relay/src/index.ts`

Why this is bloated:

- direct WebSocket relay path
- SSE fallback path
- DB-polled SSE replay path
- REST polling fallback path
- duplicated quote mapping and merge logic across layers

This means the same market state is being maintained in too many forms.

### 3) Research data is normalized in the wrong place

Key files:

- `lib/jarvis/askedgar.ts`
- `components/trading/ResearchReportSections.tsx`

Why this is bloated:

- AskEdgar fans out into many endpoints
- caching and warning logic is already complex
- then the UI still performs field fallback resolution and record coercion
- `ResearchReportSections.tsx` is acting as parser + transformer + renderer

That should be mostly server-side work.

### 4) Trade state decomposition did not actually reduce total complexity

Key files:

- `hooks/use-trades.ts`
- `hooks/use-trade-sync.ts`
- `app/page.tsx`

Why this is bloated:

- `useTrades()` still exposes a very large surface area
- `app/page.tsx` still orchestrates too much directly
- local/cloud branching still leaks throughout trade flows

This is more file-level modularity than architectural simplification.

### 5) The future agent system is overdesigned for current reality

Key file:

- `AGENTIC_EXPANSIONV2.md`

Why this is bloated:

- orchestrator + specialist agents
- Postgres-backed queue leases and heartbeats
- dual LLM lanes
- Discord-first routing and reports
- blueprint-driven handler framework
- extensive new tables and operational surface

This is a serious platform design. The current product does not yet justify building it in full.

---

## Recommended target architecture

The lean default architecture for this project should be:

### Keep

- **Next.js app** as the main UI + API surface
- **Postgres** as source of truth and cache
- **Schwab relay** as the one special realtime service
- **AskEdgar shared cache** for research data
- **Massive** for candles and delayed fallback data

### Add only if needed

- **one durable job runner** for long-running agent jobs

### Avoid for now

- multiple specialist agent services
- custom workflow-engine style abstractions
- distributed orchestration before the simpler monolith-plus-worker loop is proven

---

## Ruthless cut list

This is the blunt version: what I would cut, defer, or collapse first.

### Cut now

#### 1) Cut Jarvis platform extras

Target:

- remove or defer `lib/jarvis/circuit-breaker.ts`
- remove or defer `lib/jarvis/token-tracking.ts`
- remove or defer Jarvis admin stats/memory endpoints
- collapse chat behavior into one primary route pattern

Why:

These add operational and conceptual overhead without being core to research quality.

#### 2) Cut SSE as a second-class live architecture unless it proves necessary

Target:

- keep direct relay WebSocket as the primary live path
- remove `hooks/use-market-stream.ts` and `app/api/market-data/stream/route.ts` if relay reliability is acceptable
- keep REST snapshot only as fallback, not a parallel live system

Why:

Right now the app is paying for three transport strategies. That is too much for a small internal product.

#### 3) Cut permanent local-storage/cloud dual-runtime behavior

Target:

- stop treating local storage as a normal operating mode
- move local migration into a one-time import path
- make DB the runtime source of truth

Why:

The ongoing branching cost is likely larger than the value of keeping both modes alive.

#### 4) Cut the idea of building the full agent platform now

Target:

- do not implement `AGENTIC_EXPANSIONV2.md` as written
- defer specialist agents, lease fencing, heavy orchestration, and large agent-specific schema expansion

Why:

That work will consume a huge amount of energy before proving better agent outcomes.

### Collapse next

#### 5) Collapse research data into one server-side view model

Target:

- build one normalized `ResearchSnapshot` object on the server
- stop passing raw endpoint-shaped AskEdgar payloads into UI components
- split `ResearchReportSections.tsx` into smaller render-only sections

Why:

This reduces both UI complexity and schema inconsistency handling.

#### 6) Collapse market snapshot assembly into one reusable mapper

Target:

- centralize snapshot construction logic used by relay consumers, snapshot routes, and scanners
- eliminate duplicated merge/mapping logic across browser, API, and relay layers

Why:

This reduces drift and correctness bugs.

#### 7) Collapse trade orchestration into smaller stable interfaces

Target:

- keep one data hook for trades
- isolate API/local persistence behind a repository boundary if local import must remain
- reduce the amount of direct page-level wiring in `app/page.tsx`

Why:

This shrinks the mental model of the core app shell.

### Defer until proven necessary

#### 8) Defer persistent agent memory systems

Target:

- avoid growing memory tables, memory extraction, and long-lived insight persistence until simple context assembly proves insufficient

Why:

Most early agent quality gains come from better inputs, not memory machinery.

#### 9) Defer user-scoped research caching beyond shared provider caching

Target:

- keep shared AskEdgar cache
- defer extra report-layer caches unless they solve a real repeated latency/cost problem

Why:

Multiple caches create invalidation complexity and debugging confusion.

#### 10) Defer specialist multi-agent fanout

Target:

- start with one agent runtime and one job execution path
- only split into specialist agents once a single agent demonstrably fails due to scope overload

Why:

Premature multi-agent design is one of the easiest ways to overbuild an internal AI system.

---

## What I would build instead

If I were simplifying this project for actual use, I would aim for this operating model:

### V1 Simplified

- Next.js app remains the control plane
- Postgres stores trades, cached research, and agent run artifacts
- Schwab relay remains the only realtime sidecar
- Massive remains the source for historical candles and delayed fallback snapshots
- AskEdgar remains cached server-side and is normalized into one research snapshot shape
- one background runner handles long-running agent work
- one main agent handles research requests

### Agent data inputs

The agent should have access to:

- latest quote state from Schwab relay or last persisted realtime quote
- recent candles from Massive
- normalized AskEdgar research snapshot
- optional imported Discord notes if they truly add value

That is enough to produce useful small-cap trading research without a large distributed architecture.

---

## Decision rule for live data vs cached data

Use live streaming only when stale data by 5 to 30 seconds would materially change the decision.

### Stream

- active market monitoring
- intraday movers
- open position monitoring
- event-driven intraday agent triggers

### Poll or snapshot

- scanner views where a short delay is acceptable
- dashboard overview cards
- markets overview pages

### Cache

- dilution data
- SEC/ownership/reference data
- research summaries
- imported notes
- slow-moving fundamentals and filings

This rule should prevent the system from treating all data as realtime infrastructure.

---

## Final recommendation

The shortest path from bloated to effective is:

1. keep the app monolithic for product logic
2. keep only one special realtime service
3. move research normalization to the server
4. remove non-essential AI platform features
5. do not build the large multi-agent system yet
6. prove a single-agent + strong data inputs loop first

If that simpler system becomes clearly constrained, then add one job runner. Only after that should specialist agent splits even be reconsidered.

That sequence preserves what matters most:

- accurate research inputs
- live enough market data
- lower operational burden
- a smaller, more understandable codebase
