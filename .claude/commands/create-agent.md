Scaffold a new AI agent named: $ARGUMENTS

This creates the foundational files for a new specialized agent in the Nexus Terminal agent team. The scaffold is a starting point — we'll refine the agent's behavior after it's created.

## Before You Start

1. Read `lib/llm-client.ts` to understand the LLM client interface (`callLlm`, `callLlmStreaming`)
2. Read `lib/research.ts` as an example of an existing LLM pipeline
3. Check `app/api/` for existing API route patterns

## What to Create

### 1. Agent Pipeline (`lib/<agent-name>.ts`)
- Export a main function that takes a request and returns a structured response
- Use the existing `callLlm()` client from `lib/llm-client.ts`
- Include proper error handling with try/catch
- Keep it simple — start with a single LLM call, we can add multi-step orchestration later

### 2. System Prompt
- Define the prompt inline or in a dedicated helper in the pipeline file
- The prompt should clearly define:
  - Who the agent is (role and expertise)
  - What data it will receive
  - What format to respond in
  - What it should NOT do (constraints)
- Keep the prompt under 500 tokens to start

### 3. Types (add to `lib/types.ts` if needed)
- Add request/response types if they differ from existing types
- Keep types minimal — only add what's needed

### 4. API Route (`app/api/<agent-name>/route.ts`)
- POST handler following existing patterns in `app/api/`
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
