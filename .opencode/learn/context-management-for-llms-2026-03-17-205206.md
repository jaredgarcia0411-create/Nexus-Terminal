# Context Management for LLMs Crash Course
**Researched**: 2026-03-17
**Sources**: Web docs, official docs, codebase analysis
**Context**: Codebase-specific research

---

## Concept Overview
Context management for LLMs is the practice of choosing what information goes into each model call so responses stay accurate, relevant, and affordable. The core idea is not to keep everything forever, but to build each request from high-signal context: instructions, relevant memory, retrieved facts, recent turns, and the current user request. In practice, quality improves most when context is filtered and structured, not just enlarged.

## How It Works
A production context pipeline typically has four layers: (1) stable system/developer instructions, (2) task-relevant retrieved knowledge, (3) short recent conversation state, and (4) current user input. Before sending, you enforce a token budget, compact old turns, and drop low-value text.

For this codebase, Jarvis currently uses a server-side context builder that loads recent trades, latest macro summary, and non-expired memory from Postgres, then serializes that JSON into prompts. Conversation rows are stored, but prior turns are not currently re-injected into each prompt, so context continuity mostly comes from DB memory + fresh context assembly per request.

## Code Examples

### Basic Usage
```ts
type Message = { role: "system" | "user" | "assistant"; content: string };

function approximateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.33);
}

function packContext(params: {
  system: string;
  retrieved: string[];
  recentTurns: Message[];
  userInput: string;
  tokenBudget: number;
}): Message[] {
  const { system, retrieved, recentTurns, userInput, tokenBudget } = params;
  const out: Message[] = [{ role: "system", content: system }];
  let used = approximateTokens(system);

  for (const chunk of retrieved) {
    const t = approximateTokens(chunk);
    if (used + t > Math.floor(tokenBudget * 0.6)) break;
    out.push({ role: "system", content: `Reference: ${chunk}` });
    used += t;
  }

  for (const turn of recentTurns.slice(-6)) {
    const t = approximateTokens(turn.content);
    if (used + t > tokenBudget - approximateTokens(userInput) - 20) break;
    out.push(turn);
    used += t;
  }

  out.push({ role: "user", content: userInput });
  return out;
}
```

### In Your Codebase
From: `lib/jarvis/context.ts`
```ts
export async function buildContext(userId: string, mode: JarvisMode): Promise<JarvisContext> {
  const db = getDb();
  if (!db) return { user_trades: [], macro_summary: null, memory: [] };

  const [tradeRows, macroRows, memoryRows] = await Promise.all([
    db.select().from(trades).where(and(eq(trades.userId, userId), gte(trades.date, thirtyDaysAgo))).limit(200),
    db.select().from(macroSummaries).orderBy(desc(macroSummaries.marketDate)).limit(1),
    db.select().from(agentMemory).where(and(eq(agentMemory.userId, userId), or(isNull(agentMemory.expiresAt), gt(agentMemory.expiresAt, now)))).limit(100),
  ]);

  return {
    user_trades: tradeRows,
    macro_summary: macroRows[0] ?? null,
    memory: memoryRows,
  };
}
```

From: `lib/jarvis/prompts.ts`
```ts
function withContext(instruction: string, context: JarvisContext): string {
  return `${instruction}\n\n<context>\n${JSON.stringify(context)}\n</context>`;
}
```

From: `app/api/jarvis/chat/route.ts`
```ts
const context = await buildContext(user.id, "chat");
const userPrompt = buildChatPrompt(context, message);
const response = await callJarvis(JARVIS_SYSTEM_PROMPT, userPrompt);
```

## Best Practices
1. Use explicit token budgets per request and reserve room for output; compact before hitting hard limits.
2. Separate short-term conversation state from durable memory (facts/preferences/insights) and store durable memory in DB.
3. Retrieve context just-in-time (top-k relevant chunks) instead of always injecting full history.
4. Keep stable prompt prefixes cache-friendly and append dynamic user context last.
5. Track quality + cost metrics together (latency, token usage, retrieval hit quality, hallucination rate).

## Common Pitfalls
**Pitfall**: Sending full conversation history every turn.
**Solution**: Keep a sliding window for recent turns and maintain a compact rolling summary for older turns.

**Pitfall**: Assuming larger context window always improves answers.
**Solution**: Re-rank/filter context and prioritize evidence order; long prompts can still degrade recall.

**Pitfall**: Storing conversation data but never reusing it effectively.
**Solution**: Define a clear replay policy (recent turns + summaries + retrieved memory) and apply it consistently in prompt construction.

## Related Topics
- Retrieval-Augmented Generation (RAG) chunking and reranking
- Prompt caching and token-cost optimization
- Prompt injection defenses and trust boundaries
- Memory schema design (episodic vs semantic memory)
- LLM evaluation loops (offline test sets + online telemetry)

## Follow-up Questions

---
*To continue learning, use: `/research more about Context Management for LLMs` or ask follow-up questions*
