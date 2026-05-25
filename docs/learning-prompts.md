# Learning Prompts

Paste these into a separate Claude Code CLI session. Each one is self-contained.
Work through them in order — each builds on concepts from the previous ones.

---

## 1. Async Error Handling in React (CRITICAL — fixes a live bug pattern)

```
I'm building a React/Next.js app and I have async functions in my hooks that call APIs. Some of them use a wrapper called `withErrorToast` that shows the user an error message if the API call fails, but others don't — they just call the async function directly.

Here's an example of the GOOD pattern I already use:
```ts
withErrorToast('Failed to delete trades', async () => {
  await apiRequest('/api/trades/bulk', { method: 'POST', body: { action: 'delete', ids } });
  await refreshTrades();
});
```

And here's the BAD pattern I have in the same file:
```ts
const handleCreateManualTrade = async (trade: Trade) => {
  await apiRequest('/api/trades', { method: 'POST', body: trade });
  await refreshTrades();
};
```

Teach me:
1. What happens when an async function throws and nothing catches it? What does the user see?
2. What's the difference between a function that "throws" and one that "rejects a promise"?
3. Why does the first pattern work and the second one silently fail?
4. Show me the general rule for when I MUST handle errors vs when it's OK to let them propagate.

Use simple examples. I'm learning — don't assume I know what "unhandled promise rejection" means without explaining it.
```

---

## 2. Rate Limiting Patterns (CRITICAL — protects your wallet)

```
I have a Next.js API route that triggers expensive external API calls and LLM calls. Any authenticated user can hit it unlimited times. I need to add rate limiting but I don't have Redis — just PostgreSQL via Drizzle ORM.

Teach me:
1. What is rate limiting and why does it matter? (I know the concept vaguely but explain the mechanics)
2. What is a "sliding window" rate limiter vs a "token bucket"? Which is simpler to implement with a database?
3. Walk me through implementing a simple DB-backed rate limiter:
   - What table schema do I need?
   - How do I check the limit before processing a request?
   - How do I handle the edge case where two requests arrive at the same time?
   - What HTTP status code do I return and what headers should I include?
4. Show me a concrete implementation I could drop into a Next.js route handler that uses Drizzle ORM.

Keep it simple. I'd rather have a basic rate limiter that works than a sophisticated one I don't understand.
```

---

## 3. Zod Validation — Beyond Type Checking (HIGH — quick win)

```
I use Zod for input validation in my Next.js API routes. My current schemas look like this:

```ts
const tradeSchema = z.object({
  symbol: z.string().min(1),
  notes: z.string().optional(),
  side: z.enum(['long', 'short']),
  quantity: z.number(),
});
```

I've been told this is incomplete because I'm validating TYPE but not BOUNDS. Teach me:
1. What's the difference between type validation and bounds validation?
2. What could go wrong with `z.string().min(1)` and no `.max()`?
3. What could go wrong with `z.number()` and no `.int()`, `.positive()`, `.max()`?
4. Walk me through the full set of Zod refinements I should know about: `.max()`, `.int()`, `.positive()`, `.email()`, `.url()`, `.regex()`, `.trim()`, `.transform()`, `.refine()`.
5. Rewrite my schema above with proper bounds validation and explain each addition.
6. Show me a pattern for validating JSONB fields that come back from the database (where TypeScript thinks the type is correct but runtime data might have drifted).

I already use `parseAndValidate()` from a shared utility — I just need to write better schemas.
```

---

## 4. Database Pagination (HIGH — prevents future outage)

```
My Next.js app has a GET /api/trades route that fetches ALL trades for a user with no LIMIT. Right now users have a few hundred trades and it's fine, but after a year or two of daily trading this could be 10,000+ rows.

I use Drizzle ORM with PostgreSQL (Neon). Teach me:
1. Why are unbounded queries dangerous? What actually happens at the database and network level when you fetch 10,000 rows?
2. What's the difference between offset-based pagination (`LIMIT 50 OFFSET 100`) and cursor-based pagination? When should I use which?
3. Why is cursor-based pagination better for data that changes (new trades being added)?
4. Show me a concrete Drizzle implementation of cursor-based pagination for a trades table sorted by date descending. Include:
   - The API route handler
   - The query with cursor support
   - What the response shape should look like (including the cursor for the next page)
5. On the frontend, what pattern should I use to load more data? (I use React hooks with fetch)
6. What about my current pattern where the UI loads ALL trades to do client-side filtering and sorting? How do I handle that if I paginate?

I need to understand the tradeoffs, not just the implementation.
```

---

## 5. TypeScript Type Narrowing vs Type Assertions (HIGH — stops hiding bugs)

```
I have code like this in my codebase:

```ts
// Pattern 1: type assertion (I use this a lot)
const user = session?.user as { id: string; name: string } | undefined;

// Pattern 2: as unknown as (I have a few of these)
const db = getDb() as unknown as Parameters<typeof recordLlmAttempt>[0];

// Pattern 3: explicit any
export const parsePrice = (val: any): number => { ... }
```

I've been told these are unsafe. Teach me:
1. What does `as` actually do in TypeScript? Why is it called an "assertion" and not a "conversion"?
2. What's the difference between `as` (tells TypeScript to trust you) and a type guard (proves the type at runtime)?
3. Show me how to replace Pattern 1 with a runtime type guard. What's the syntax for writing one?
4. When is `as unknown as` a sign of a real problem vs an acceptable workaround? How do I tell the difference?
5. How do I replace `any` with `unknown` and what changes in the function body?
6. What are discriminated unions and how do they eliminate the need for type assertions?

Use my actual code patterns as examples. I need to understand WHEN each approach is appropriate, not just that `as` is "bad."
```

---

## 6. React Context — Solving Prop Drilling (MEDIUM — architectural improvement)

```
My app has a root component (app/page.tsx) that pulls ~25 values from a hook called useTrades() and threads them through 3 levels of components:

page.tsx → ManagementTab → JournalTab (and 5 other tabs)

ManagementTab receives 20+ props just to forward them down. Every time I add a new feature, I have to add a prop to 3 files.

I've been told React Context would solve this. Teach me:
1. What is React Context? Explain it like I've never seen it before.
2. Walk me through creating a context for my trades data:
   - Where does the Provider go?
   - How do child components access the data?
   - What happens to re-renders? (I've heard Context causes performance problems)
3. When should I use Context vs just passing props? What's the rule of thumb?
4. What's the difference between Context, Zustand, and Redux? Do I need any of them or is Context enough?
5. Show me a before/after of my prop drilling pattern vs using Context.

I want the simplest solution that eliminates the prop threading. I don't want to install a library if React's built-in solution works.
```

---

## 7. React Hooks Deep Dive — Dependencies, Cleanup, and Race Conditions (MEDIUM)

```
I use React hooks (useEffect, useCallback, useMemo) in my app but I don't fully understand the dependency array. I have patterns like this:

```ts
// Pattern 1: I include a module-level function in deps
const refreshTrades = useCallback(async () => {
  const data = await fetchTrades();
  setTrades(sortTradesByDate(data)); // sortTradesByDate is defined outside the component
}, [sortTradesByDate]); // <-- is this necessary?

// Pattern 2: I have a useEffect with an eslint-disable
useEffect(() => {
  loadChartData(ticker, timeframe);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ticker]); // intentionally excluding timeframe
```

Teach me:
1. What IS the dependency array? What does React actually do with it?
2. When does a value need to be in the dependency array? What's the rule?
3. Why do module-level functions NOT need to be in deps? What about functions from hooks?
4. When is it OK to eslint-disable the exhaustive-deps rule vs when is it hiding a bug?
5. What is a "stale closure" and how does it relate to dependency arrays?
6. Show me the correct pattern for "I want this effect to run when ticker changes but NOT when timeframe changes" without disabling the lint rule.
7. What is cleanup in useEffect and when do I need it? Show me the AbortController pattern for fetch calls.

I've seen these patterns in my codebase but I've been copying them without fully understanding why.
```
