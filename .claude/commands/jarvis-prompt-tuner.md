Analyze and improve Jarvis AI prompts for: $ARGUMENTS

If no specific prompt is given, audit all prompts in `lib/jarvis/prompts.ts`.

## Process

### 1. Read Current Prompts
- Read `lib/jarvis/prompts.ts` to understand all system and user prompt templates
- Read `lib/jarvis/types.ts` to understand JarvisMode and request/response types
- Read `lib/jarvis/client.ts` to understand how prompts are sent to the LLM

### 2. Evaluate Each Prompt For
- **Clarity**: Is the instruction unambiguous? Would a different LLM interpret it the same way?
- **Specificity**: Does it tell the model exactly what format to respond in?
- **Trading domain accuracy**: Are trading terms used correctly? (PnL, R-multiple, dilution, float, volume, etc.)
- **Token efficiency**: Is there unnecessary verbosity? Can the same instruction be shorter without losing meaning?
- **Hallucination prevention**: Does it constrain the model to only use provided data, not make up numbers or tickers?
- **Output format**: Does it specify JSON structure, markdown format, or plain text clearly?

### 3. Suggest Improvements
For each prompt that can be improved:
- Show the current prompt (or relevant section)
- Explain what's wrong or suboptimal in plain language
- Show the improved version
- Explain why the change helps

### 4. Apply Changes
After discussing recommendations, apply the approved changes to `lib/jarvis/prompts.ts`.
Run `npm run lint && npx tsc --noEmit` to verify.

## Rules
- Never remove safety constraints or rate limiting references from prompts
- Keep prompts concise — every token costs money
- Always maintain the existing response format unless explicitly asked to change it
- Test that prompt changes don't break the type system (JarvisResponse, etc.)
