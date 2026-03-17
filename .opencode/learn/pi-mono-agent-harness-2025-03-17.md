# Pi Mono Agent Harness Research Report

**Researched**: March 17, 2026  
**Sources**: pi-mono repository, Microsoft AutoGen, LangGraph, OpenAI Agents SDK, Pydantic AI, Nexus Terminal codebase

---

## Executive Summary

The "pi mono agent harness" refers to the agent runtime pattern in the pi-mono repository by Mario Zechner (badlogic). It provides a clean, event-driven architecture for building LLM-powered agents with tool calling, state management, and streaming. This research compares it against industry standards and extracts actionable patterns.

---

## 1. Pi Mono Agent Core Architecture

### Key Components

**Source**: `packages/agent/src/agent.ts`, `packages/agent/src/agent-loop.ts`

The pi-mono agent harness consists of:

1. **Agent Class** - Central orchestrator managing state, events, and execution
2. **Agent Loop** - Core execution engine handling the conversation loop
3. **Event System** - Fine-grained lifecycle events for UI updates
4. **Tool System** - Type-safe tool definitions with validation via TypeBox
5. **Message Types** - Extensible `AgentMessage` supporting custom message types

### Core Pattern: Event-Driven Agent Loop

```typescript
// From pi-mono/packages/agent/src/agent.ts
export class Agent {
  private _state: AgentState = {
    systemPrompt: "",
    model: getModel("google", "gemini-2.5-flash-lite-preview-06-17"),
    thinkingLevel: "off",
    tools: [],
    messages: [],
    isStreaming: false,
    streamMessage: null,
    pendingToolCalls: new Set<string>(),
    error: undefined,
  };

  // Event subscription for UI updates
  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Main execution entry
  async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]) {
    // ... validation and execution
    await this._runLoop(msgs);
  }
}
```

### Event Flow Pattern

```
prompt("Hello")
├─ agent_start
├─ turn_start
├─ message_start/end (user message)
├─ message_start (assistant)
├─ message_update... (streaming chunks)
├─ message_end (complete response)
├─ turn_end
└─ agent_end
```

With tool calls:
```
├─ turn_start
├─ message_start/end (user)
├─ message_start/end (assistant with toolCall)
├─ tool_execution_start
├─ tool_execution_update (if streaming)
├─ tool_execution_end
├─ message_start/end (toolResult)
├─ turn_end
└─ agent_end
```

### Tool Definition Pattern

```typescript
// From pi-mono/packages/agent/src/types.ts
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> 
  extends Tool<TParameters> {
  label: string;  // Human-readable for UI
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

// Usage example
const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    const content = await fs.readFile(params.path, "utf-8");
    return {
      content: [{ type: "text", text: content }],
      details: { path: params.path, size: content.length },
    };
  },
};
```

---

## 2. Industry Comparison

### Framework Comparison Matrix

| Feature | Pi Mono | AutoGen | LangGraph | OpenAI SDK | Pydantic AI |
|---------|---------|---------|-----------|------------|-------------|
| **Language** | TypeScript | Python | Python | Python | Python |
| **Architecture** | Event-driven | Message-passing | Graph-based | Agent-as-tool | Type-safe classes |
| **State Management** | In-memory | Serializable | Persistent | Session-based | Durable execution |
| **Tool System** | TypeBox schemas | Python functions | Python functions | Pydantic models | Pydantic models |
| **Streaming** | Native | Yes | Yes | Yes | Yes |
| **Multi-Agent** | Handoffs | Native | Subgraphs | Delegation | Graph nodes |
| **UI Integration** | Event streams | Console | LangSmith | Tracing | Logfire |

### Pattern Analysis

#### Pi Mono Strengths:
- Clean event-driven architecture
- Type-safe tool definitions via TypeBox
- Extensible message types via declaration merging
- Steering/follow-up message queues for real-time control
- Parallel vs sequential tool execution modes

#### OpenAI Agents SDK Strengths:
- Guardrails for input/output validation
- MCP (Model Context Protocol) server support
- Structured output with Pydantic
- Human-in-the-loop built-in
- Tracing for debugging

#### LangGraph Strengths:
- Durable execution with persistence
- Human-in-the-loop via interrupts
- Complex workflow orchestration
- State graph visualization

#### Pydantic AI Strengths:
- Full type safety
- Dependency injection pattern
- Durable execution
- MCP integration

---

## 3. Key Architectural Patterns

### Pattern 1: Extensible Message Types

**Source**: pi-mono/packages/agent/src/types.ts

```typescript
// Extensible via declaration merging
export interface CustomAgentMessages {
  // Apps extend this interface
}

export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// Extension example
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    notification: {
      role: "notification";
      text: string;
      timestamp: number;
    };
  }
}
```

**Why it matters**: Allows UI-specific messages without polluting LLM context.

### Pattern 2: Transform Context Before LLM

**Source**: pi-mono/packages/agent/src/types.ts

```typescript
export interface AgentLoopConfig {
  // Convert AgentMessage[] to LLM-compatible Message[]
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  
  // Optional: prune, inject external context
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
}
```

**Why it matters**: Separation between internal state (rich types) and LLM context (filtered/transformed).

### Pattern 3: Tool Execution Hooks

```typescript
export interface AgentLoopConfig {
  // Pre-flight check - can block execution
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => 
    Promise<BeforeToolCallResult | undefined>;
  
  // Post-processing - can modify results
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => 
    Promise<AfterToolCallResult | undefined>;
}
```

**Why it matters**: Enables approval workflows, logging, result transformation without tool modifications.

### Pattern 4: Steering/Follow-Up Messages

**Source**: pi-mono/packages/agent/src/agent.ts

```typescript
// Interrupt agent mid-run (e.g., user types "stop")
steer(m: AgentMessage) {
  this.steeringQueue.push(m);
}

// Queue work after agent finishes
followUp(m: AgentMessage) {
  this.followUpQueue.push(m);
}
```

**Why it matters**: Real-time user control without race conditions or dropped messages.

### Pattern 5: Parallel vs Sequential Tool Execution

```typescript
export type ToolExecutionMode = "sequential" | "parallel";

// Sequential: tool A finishes, then tool B starts
// Parallel: all tools prepared sequentially, then executed concurrently
// Results still emitted in assistant's source order
```

**Trade-off**: Parallel is faster but loses strict ordering guarantees between tools.

---

## 4. Nexus Terminal Integration Analysis

### Current State: Direct LLM Client Pattern

**File**: `lib/jarvis/client.ts`

```typescript
// Current pattern - simple fetch wrapper
export async function callJarvis(
  systemPrompt: string, 
  userMessage: string, 
  temperature = 0.2
): Promise<JarvisClientResult> {
  // Circuit breaker check
  if (isCircuitOpen()) {
    throw new Error('Jarvis circuit breaker is open');
  }
  
  // Direct API call
  const result = await requestLlm(systemPrompt, userMessage, temperature);
  recordLlmSuccess();
  return result;
}
```

### What Nexus Terminal is Missing

1. **No tool calling infrastructure** - Each mode (chat/research/trade-analysis) is hardcoded
2. **No conversation state** - Each request is independent
3. **No event streaming** - Binary response vs streaming updates
4. **No extensible message types** - Fixed request/response shapes
5. **No agent loop** - No automatic retry/resumption on failure

### Migration Path to Agent Harness Pattern

```typescript
// Proposed: Agent-based Jarvis service
import { Agent } from '@/lib/agent/agent';

const jarvisAgent = new Agent({
  initialState: {
    systemPrompt: getSystemPromptForMode(mode),
    model: getModel('groq', process.env.JARVIS_MODEL || 'llama-3.3-70b'),
    tools: [
      researchTool,
      tradeAnalysisTool,
      dilutionResearchTool,
    ],
  },
  convertToLlm: (messages) => messages.filter(m => 
    m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'
  ),
});

// Usage in API route
agent.subscribe((event) => {
  // Stream events to SSE
  if (event.type === 'message_update') {
    sendSSE(event);
  }
});

await agent.prompt(userMessage);
```

---

## 5. Best Practice Recommendations

### For TypeScript/Next.js Projects

**1. Use Event-Driven Architecture**

```typescript
// Good: Events allow UI to react to every state change
agent.subscribe((event) => {
  switch (event.type) {
    case 'message_update':
      updateUI(event.message);
      break;
    case 'tool_execution_start':
      showLoadingIndicator(event.toolName);
      break;
    case 'tool_execution_end':
      hideLoadingIndicator(event.toolName);
      break;
  }
});
```

**2. Separate Internal State from LLM Context**

```typescript
// Good: Transform context before sending to LLM
const agent = new Agent({
  transformContext: async (messages) => {
    // Remove old messages to fit token limit
    if (estimateTokens(messages) > MAX_TOKENS) {
      return pruneOldMessages(messages);
    }
    return messages;
  },
  convertToLlm: (messages) => {
    // Filter out UI-only messages
    return messages.filter(m => 
      ['user', 'assistant', 'toolResult'].includes(m.role)
    );
  },
});
```

**3. Use Structured Tool Definitions**

```typescript
// Good: TypeBox for runtime validation + TypeScript types
import { Type } from '@sinclair/typebox';

const searchTool: AgentTool = {
  name: 'search_trades',
  label: 'Search Trades',
  description: 'Search trades by symbol or date',
  parameters: Type.Object({
    symbol: Type.Optional(Type.String()),
    startDate: Type.Optional(Type.String({ format: 'date' })),
    endDate: Type.Optional(Type.String({ format: 'date' })),
  }),
  execute: async (toolCallId, params) => {
    // params is typed: { symbol?: string, startDate?: string, endDate?: string }
    const trades = await searchTrades(params);
    return {
      content: [{ type: 'text', text: JSON.stringify(trades) }],
      details: { count: trades.length },
    };
  },
};
```

**4. Implement Circuit Breakers**

```typescript
// From Nexus Terminal: lib/jarvis/circuit-breaker.ts
export function isCircuitOpen(): boolean {
  if (failureCount < CIRCUIT_THRESHOLD) return false;
  const now = Date.now();
  if (now - lastFailureTime > CIRCUIT_RESET_MS) {
    // Reset after cooldown
    failureCount = 0;
    return false;
  }
  return true;
}
```

**5. Support Streaming for Better UX**

```typescript
// Always provide streaming option
export async function callJarvisStreaming(
  systemPrompt: string,
  userMessage: string,
): Promise<ReadableStream<string>> {
  const response = await fetch(LLM_API, {
    body: JSON.stringify({ stream: true, /* ... */ }),
  });
  
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      // Parse SSE chunks and enqueue text
      const text = extractTextFromChunk(value);
      controller.enqueue(text);
    },
  });
}
```

---

## 6. Integration Patterns

### Pattern A: Direct Integration (Current Nexus Terminal)

**Pros**: Simple, fast to implement  
**Cons**: No tool calling, no conversation state, no streaming

### Pattern B: Agent Harness (Recommended)

**Pros**: Full tool ecosystem, conversation history, streaming, extensible  
**Cons**: More complex, requires event handling infrastructure

### Pattern C: Hybrid - Tool-Only Agent

Use agent pattern only for complex workflows:

```typescript
// Simple queries - direct LLM call
if (isSimpleQuery(message)) {
  return await callJarvis(systemPrompt, message);
}

// Complex queries - use agent with tools
const agent = new Agent({ tools: [researchTool, analysisTool] });
return await agent.prompt(message);
```

---

## 7. Key Trade-offs

### Event-Driven vs Direct
- **Direct**: Simpler code, easier debugging
- **Event-driven**: Real-time UI updates, better user experience

### Parallel vs Sequential Tools
- **Sequential**: Predictable ordering, easier debugging
- **Parallel**: Faster execution, but lose strict ordering

### In-Memory vs Persistent State
- **In-memory**: Faster, simpler (pi-mono approach)
- **Persistent**: Recovery from crashes, long-running workflows (LangGraph approach)

### TypeBox vs Zod vs Pydantic
- **TypeBox**: Best for TypeScript, smaller bundle
- **Zod**: More popular, better ecosystem
- **Pydantic**: Python standard, rich validation

---

## 8. Recent Best Practice Shifts (2025)

1. **MCP (Model Context Protocol)**: Standard for tool servers (used by OpenAI SDK, Pydantic AI)
2. **Structured Outputs**: Moving from text parsing to native JSON schemas
3. **Durable Execution**: LangGraph's persistence model gaining traction
4. **Type Safety**: Pydantic AI showing TypeScript-level safety is possible in Python
5. **Streaming First**: All major frameworks now treat streaming as default

---

## 9. Code Examples: Minimal Agent Harness

```typescript
// lib/agent/types.ts
import type { Static, TSchema } from '@sinclair/typebox';

export interface AgentTool<TParams extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
    onUpdate?: (result: ToolResult<TDetails>) => void,
  ) => Promise<ToolResult<TDetails>>;
}

export interface ToolResult<TDetails> {
  content: Array<{ type: 'text'; text: string }>;
  details: TDetails;
}

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'message_start'; message: Message }
  | { type: 'message_update'; message: Message }
  | { type: 'message_end'; message: Message }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: ToolResult<unknown> };

export interface Message {
  role: 'user' | 'assistant' | 'toolResult';
  content: string | Array<{ type: string }>;
  timestamp: number;
}
```

```typescript
// lib/agent/agent.ts
import type { AgentEvent, AgentTool, Message, ToolResult } from './types';

export class Agent {
  private listeners = new Set<(e: AgentEvent) => void>();
  private messages: Message[] = [];
  private tools: AgentTool[] = [];
  private abortController?: AbortController;

  constructor(private config: { systemPrompt: string; model: string }) {}

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setTools(tools: AgentTool[]) {
    this.tools = tools;
  }

  async prompt(content: string): Promise<void> {
    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    this.messages.push(userMessage);
    this.emit({ type: 'message_start', message: userMessage });
    this.emit({ type: 'message_end', message: userMessage });

    await this.runAgentLoop();
  }

  private async runAgentLoop(): Promise<void> {
    this.emit({ type: 'agent_start' });
    this.abortController = new AbortController();

    try {
      // Call LLM with current context
      const response = await this.callLLM();
      
      // Handle tool calls if present
      if (this.hasToolCalls(response)) {
        await this.executeToolCalls(response);
      }

      this.emit({ type: 'agent_end' });
    } catch (error) {
      console.error('Agent error:', error);
      throw error;
    }
  }

  private async executeToolCalls(assistantMessage: Message): Promise<void> {
    const toolCalls = this.extractToolCalls(assistantMessage);
    
    for (const toolCall of toolCalls) {
      this.emit({
        type: 'tool_execution_start',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });

      const tool = this.tools.find((t) => t.name === toolCall.name);
      if (!tool) {
        throw new Error(`Tool ${toolCall.name} not found`);
      }

      const result = await tool.execute(
        toolCall.id,
        toolCall.arguments,
        this.abortController?.signal,
      );

      this.emit({
        type: 'tool_execution_end',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
      });
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}
```

---

## 10. Summary

The pi-mono agent harness provides an excellent reference for building agent systems in TypeScript:

**Adopt these patterns:**
1. Event-driven architecture for real-time UI updates
2. Extensible message types via declaration merging
3. Transform context before sending to LLM
4. Tool execution hooks (before/after)
5. Steering/follow-up message queues
6. TypeBox for runtime validation

**Consider these alternatives:**
- Use LangGraph if you need durable execution and complex workflows
- Use Pydantic AI if you're in Python and want maximum type safety
- Use OpenAI SDK if you need MCP support and guardrails

**For Nexus Terminal:**
The current Jarvis implementation could benefit from adopting the agent harness pattern for complex modes (research, trade analysis) while keeping simple modes as direct LLM calls. The event system would enable streaming UI updates, and tool definitions would make the system extensible without code changes.

---

*For follow-up questions, ask about specific patterns, implementation details, or migration strategies.*
