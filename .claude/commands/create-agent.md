Scaffold a new Jarvis AI agent named: $ARGUMENTS

This creates the foundational files for a new specialized agent in the Nexus Terminal agent team. The scaffold is a starting point — we'll refine the agent's behavior after it's created.

## Before You Start

1. Read `lib/jarvis/types.ts` to understand existing types (JarvisMode, JarvisRequest, JarvisResponse)
2. Read `lib/jarvis/prompts.ts` to see how other modes construct prompts
3. Read `lib/jarvis/client.ts` to understand the LLM client interface
4. Read `lib/jarvis/research.ts` and `lib/jarvis/trade-analysis.ts` as examples of existing pipelines
5. Check `app/api/jarvis/` for existing API route patterns

## What to Create

### 1. Agent Pipeline (`lib/jarvis/<agent-name>.ts`)
- Export a main function that takes a request and returns a structured response
- Use the existing `callLLM()` client from `lib/jarvis/client.ts`
- Include proper error handling with try/catch
- Add token tracking via `lib/jarvis/token-tracking.ts`
- Keep it simple — start with a single LLM call, we can add multi-step orchestration later

### 2. System Prompt (add to `lib/jarvis/prompts.ts`)
- Add a new prompt builder function for this agent's mode
- The prompt should clearly define:
  - Who the agent is (role and expertise)
  - What data it will receive
  - What format to respond in
  - What it should NOT do (constraints)
- Keep the prompt under 500 tokens to start

### 3. Types (add to `lib/jarvis/types.ts`)
- Add the new mode to the JarvisMode union type
- Add request/response types if they differ from the base types
- Keep types minimal — only add what's needed

### 4. API Route (`app/api/jarvis/<agent-name>/route.ts`)
- POST handler following existing patterns
- Must call `requireUser()` for auth
- Validate request body
- Call the agent pipeline
- Return structured JSON response

### 5. Update Exports
- Add the new agent to any barrel exports or registries if they exist

## After Scaffolding

Run `npm run lint && npx tsc --noEmit` to verify everything compiles.

Then tell me:
- What the agent does and what we might want to customize
- What inputs it needs (which we can refine)
- How it connects to the rest of the system
- Suggested next steps to make it smarter

## Rules
- Use `requireUser()` in the API route — no exceptions
- Never expose API keys in client-side code
- Follow existing code patterns — don't introduce new frameworks or libraries
- Start simple. One LLM call, one response. We add complexity later.
- The agent advises, it does NOT execute trades or take actions
