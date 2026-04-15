Explain this concept in plain language using examples from the Nexus Terminal codebase: $ARGUMENTS

## How to Teach

1. **Start with the "what"** — one plain-language sentence explaining the concept. No jargon.
2. **Show a real example** — find where this pattern already exists in the Nexus Terminal codebase using Grep/Glob/Read. Show the actual code with file path and line numbers.
3. **Walk through the example** — explain what each part does, line by line if needed. Connect it to something the user already understands.
4. **Show the "why"** — explain why this pattern exists. What problem does it solve? What would go wrong without it?
5. **Common gotchas** — 1-2 mistakes beginners make with this concept.

## Rules

- Always search the codebase first. Use real examples from this project, not generic ones.
- If the concept doesn't exist in the codebase yet, use a simple standalone example and note that it's not currently used in the project.
- Keep explanations short. If you can explain it in 3 sentences, don't use 10.
- Use analogies to non-programming concepts when helpful (e.g., "a Promise is like ordering food at a counter — you get a receipt immediately, but the food arrives later").
- Don't explain things the user already knows. Focus on the new concept, not the surrounding syntax.
- If the concept has layers (e.g., "async/await" requires understanding Promises first), start with the foundation and build up. Ask if they want to go deeper.

## Example Topics

- `/learn generics` — TypeScript generics with examples from the codebase
- `/learn useEffect` — React useEffect with examples from existing components
- `/learn middleware` — Next.js middleware with the project's middleware.ts
- `/learn connection pooling` — database connection patterns with Neon setup
- `/learn SSE` — Server-Sent Events pattern used in `lib/sse.ts` and streaming research routes
- `/learn composite primary key` — why trades table uses (user_id + id)
