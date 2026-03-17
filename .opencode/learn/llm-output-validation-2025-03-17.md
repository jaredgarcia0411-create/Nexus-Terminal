# LLM Output Validation Crash Course

**Researched**: 2025-03-17
**Sources**: Web docs, official docs, codebase analysis  
**Context**: Nexus Terminal (Next.js + TypeScript + Zod + LLM integration)

---

## Concept Overview

LLM Output Validation is the process of enforcing structure and type safety on AI-generated content before it enters your application. Since LLMs return unstructured text or JSON that can hallucinate fields or produce malformed data, you need a validation layer to catch these errors and prevent them from corrupting your database or crashing your UI.

## How It Works

1. **Define a schema** using Zod that specifies expected output structure, types, and constraints
2. **Send the schema to the LLM** via structured output APIs (OpenAI's `response_format`, etc.) or include it in the prompt
3. **Parse the response** using `schema.safeParse()` which returns either valid data or detailed error information
4. **Handle failures gracefully** by retrying, using defaults, or returning user-friendly error messages

## Code Examples

### Basic Zod Schema with LLM

```typescript
import { z } from 'zod';
import OpenAI from 'openai';

// Define what the LLM should return
const tradeAnalysisSchema = z.object({
  summary: z.string().min(10).max(500),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().min(0).max(1),
  keyFactors: z.array(z.string()).max(5),
});

type TradeAnalysis = z.infer<typeof tradeAnalysisSchema>;

async function analyzeTrade(symbol: string): Promise<TradeAnalysis | null> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'You are a trading analyst. Respond with JSON matching the schema.',
      },
      {
        role: 'user',
        content: `Analyze ${symbol} and provide: summary, sentiment, confidence score (0-1), and up to 5 key factors.`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;

  // Validate LLM output
  const result = tradeAnalysisSchema.safeParse(JSON.parse(raw));
  
  if (!result.success) {
    console.error('LLM output validation failed:', result.error.errors);
    return null; // Or retry with different prompt
  }

  return result.data;
}
```

### Nexus Terminal Pattern (API Route)

```typescript
// lib/validations/jarvis.ts
import { z } from 'zod';

export const jarvisChatSchema = z.object({
  message: z.string().trim().min(1, 'message is required'),
  session_id: z.string().trim().optional(),
});

// lib/api-route-utils.ts
import { z } from 'zod';

type ValidateResult<T> =
  | { data: T; error?: never }
  | { data?: never; error: Response };

export async function parseAndValidate<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ValidateResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      error: Response.json(
        { error: 'Validation failed', details: z.flattenError(result.error) },
        { status: 400 },
      ),
    };
  }

  return { data: result.data };
}

// app/api/jarvis/chat/route.ts
import { parseAndValidate } from '@/lib/api-route-utils';
import { jarvisChatSchema } from '@/lib/validations/jarvis';

export async function POST(request: Request) {
  const bodyState = await parseAndValidate(request, jarvisChatSchema);
  
  if (bodyState.error) {
    return bodyState.error;
  }

  // bodyState.data is now type-safe
  const { message, session_id } = bodyState.data;
  // ...process request
}
```

### LLM Response Validation with Retry

```typescript
import { z } from 'zod';

const llmResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string().url()).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});

async function callLLMWithValidation(prompt: string, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchLLMResponse(prompt);
    const parsed = llmResponseSchema.safeParse(response);
    
    if (parsed.success) {
      return parsed.data;
    }
    
    if (attempt === maxRetries) {
      // Fallback: return safe defaults
      return {
        answer: 'Unable to generate response',
        sources: [],
        confidence: 0,
      };
    }
    
    // Retry with stronger instructions
    prompt += '\n\nIMPORTANT: Your previous response was invalid. Please follow the schema exactly.';
  }
}
```

## Best Practices

1. **Use `.safeParse()` not `.parse()`** — Prevents throwing exceptions; gives you control over error handling
2. **Provide explicit constraints** — Use `.min()`, `.max()`, `.email()`, `.url()` to catch LLM hallucinations early
3. **Set sensible defaults** — Use `.default()` for optional fields so partial failures don't break your app
4. **Log validation failures** — Track what the LLM returned vs. what you expected to improve prompts
5. **Separate schemas by context** — Keep input schemas (`jarvisChatSchema`) distinct from output schemas to avoid over-validation

## Common Pitfalls

**Pitfall**: Trusting LLM to always return valid JSON even with `json_object` response format
**Solution**: Always wrap in try/catch and validate — LLMs can return malformed JSON or extra text

**Pitfall**: Using strict schemas that reject slightly off but usable responses
**Solution**: Use `.transform()` for normalization and `.catch()` for fallbacks:
```typescript
const flexibleSchema = z.object({
  price: z.union([z.string(), z.number()])
    .transform((v) => typeof v === 'string' ? parseFloat(v) : v)
    .refine((v) => !isNaN(v), { message: 'Invalid price' }),
});
```

**Pitfall**: No fallback when validation fails, causing complete request failure
**Solution**: Implement graceful degradation — return partial data, cached responses, or user-friendly errors instead of crashing

## Related Topics

- Structured Output APIs (OpenAI, Anthropic)
- JSON Schema for LLMs
- Prompt Engineering for consistent responses
- Circuit breakers for LLM failures
- Type-safe API routes with Zod

---

*To continue learning, use: `/research structured output APIs` or `/research prompt engineering`*

---

## Follow-up Questions

### Q: What are the key differences between Zod v3 and v4 error handling?

**Asked**: March 17, 2025  
**Answer**:

Zod v4 introduces several breaking changes in error handling:

1. **Flattening Errors**: Use `z.flattenError(result.error)` (standalone function) instead of `result.error.flatten()` (method)

2. **Error Maps**: Unified `error` param replaces separate `message` and `errorMap` params:
```typescript
// v3
z.string({ message: "Required" })
z.string({ errorMap: (issue, ctx) => ({ message: "Custom" }) })

// v4
z.string({ error: "Required" })
z.string({ error: (issue) => "Custom" })
```

3. **New String Types**: v4 adds built-in validators:
   - `z.email()` - Email validation
   - `z.iso.datetime()` - ISO 8601 dates
   - `z.uuid()` - UUID validation
   - `z.stringbool()` - Parse "true"/"false" strings to boolean

4. **Strict/Loose Objects**: New explicit modes:
   - `z.strictObject()` - Throws on unknown keys
   - `z.looseObject()` - Passes through unknown keys
   - Regular `z.object()` - Strips unknown keys (default)

### Q: How should I handle LLM responses that might be wrapped in markdown?

**Asked**: March 17, 2025  
**Answer**:

LLMs often wrap JSON in markdown code fences. Use this extraction pattern (from your codebase):

```typescript
function parseLLMJson(text: string): unknown {
  // Try raw JSON first
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }

  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch { /* fall through */ }
  }

  // Final fallback
  return { message: text };
}
```

This tries: (1) direct JSON parse, (2) extracting from markdown fences, (3) wrapping raw text in a fallback object.

### Q: What's the recommended approach for validating streaming LLM responses?

**Asked**: March 17, 2025  
**Answer**:

For streaming, collect the full response first, then validate:

```typescript
// Collect chunks
let fullResponse = '';
for await (const chunk of stream) {
  fullResponse += chunk.choices[0]?.delta?.content || '';
}

// Extract and validate
const parsed = parseLLMJson(fullResponse);
const result = mySchema.safeParse(parsed);

if (!result.success) {
  // Log for debugging
  console.error('Validation failed:', result.error.issues);
  console.error('Raw response:', fullResponse);
  // Return fallback or retry
}
```

Your codebase uses this pattern in `lib/jarvis/client.ts` for streaming chat completions.

### Q: When should I use type guards vs Zod schemas?

**Asked**: March 17, 2025  
**Answer**:

**Use Zod schemas when:**
- Validating external data (API responses, user input)
- Need detailed error messages
- Want runtime + compile-time safety
- Validating complex nested structures

**Use type guards when:**
- Doing simple runtime checks
- Performance critical paths (type guards are faster)
- Narrowing within a larger validation flow
- Checking specific properties selectively

**Example from your codebase** (`lib/jarvis/research.ts:38-40`):
```typescript
// Type guard for quick check
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Used before detailed validation
const parsedObj = isObject(parsed) ? parsed : {};
```

Best practice: Use type guards for quick filtering, Zod for comprehensive validation.

---

*Additional sources referenced*:
- Zod v4 API docs: https://zod.dev/api
- Zod Error Customization: https://zod.dev/error-customization  
- Zod Error Formatting: https://zod.dev/error-formatting
- Nexus Terminal codebase: `lib/api-route-utils.ts`, `lib/validations/*.ts`, `lib/jarvis/research.ts`
