# Good Habits for Context Management While Using Coding Assistants Crash Course
**Researched**: 2026-03-17
**Sources**: OpenAI docs, Anthropic engineering guidance, GitHub Copilot docs, codebase analysis
**Context**: Practical habits for day-to-day coding assistant use, tailored to this repository workflow

---

## Concept Overview
Context management is the habit of feeding a coding assistant only the information it needs, in the right order, at the right time. Good context is not "more text"; it is structured signal: goals, constraints, relevant files, and recent decisions. If you do this well, you get fewer wrong edits, fewer re-prompts, and faster iterations.

## How It Works
Use a layered context stack for each request: (1) stable rules, (2) task goal + acceptance criteria, (3) relevant code/files only, and (4) latest state (errors, test output, blockers). Keep a token budget, trim stale details, and summarize decisions after each major step so future prompts stay aligned.

In this codebase, this pattern already appears in practice:
- `AGENTS.md` and `CLAUDE.md` provide stable repo/user constraints.
- `HANDOFF.md` carries the active implementation context and phase order.
- `.claude/commands/plan-out.md` explicitly requires research before planning.
- `.opencode/commands/research.md` forces web + codebase + synthesis.

## Code Examples

### 1) Build a "task brief" before asking for code (Node.js, runnable)
Use this script to create a compact brief from your intent. This keeps prompts consistent and reduces missing constraints.

```js
// save as: scripts/build-task-brief.mjs
import fs from "node:fs";

function buildTaskBrief({
  goal,
  constraints,
  touchedFiles,
  doneDefinition,
  latestState,
}) {
  return [
    "# Task Brief",
    `Goal: ${goal}`,
    "",
    "Constraints:",
    ...constraints.map((c) => `- ${c}`),
    "",
    "Files likely involved:",
    ...touchedFiles.map((f) => `- ${f}`),
    "",
    "Definition of done:",
    ...doneDefinition.map((d) => `- ${d}`),
    "",
    "Latest state:",
    latestState || "- none",
    "",
  ].join("\n");
}

const brief = buildTaskBrief({
  goal: "Fix broken CSV import date parsing",
  constraints: [
    "Do not change schema",
    "Use existing parser pattern in lib/parsers",
    "Run lint + type-check + tests",
  ],
  touchedFiles: ["lib/csv-parser.ts", "__tests__/csv-parser.test.ts"],
  doneDefinition: [
    "Imports timezone-aware timestamps correctly",
    "Existing CSV tests still pass",
  ],
  latestState: "Failing test: stores explicit timezone timestamps",
});

fs.writeFileSync("./task-brief.md", brief, "utf8");
console.log("Wrote ./task-brief.md");
```

Run it:

```bash
node scripts/build-task-brief.mjs
```

### 2) Pack context with a hard budget (TypeScript, runnable with ts-node or as plain JS)
This avoids dumping whole logs/files and keeps the assistant focused.

```ts
type Section = { label: string; text: string; priority: number };

function approxTokens(text: string): number {
  // Fast approximation for budgeting in tooling workflows.
  return Math.ceil(text.length / 4);
}

function packContext(sections: Section[], tokenBudget: number): string {
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);
  const out: string[] = [];
  let used = 0;

  for (const s of sorted) {
    const block = `## ${s.label}\n${s.text}`;
    const cost = approxTokens(block);
    if (used + cost > tokenBudget) continue;
    out.push(block);
    used += cost;
  }

  return out.join("\n\n");
}

const packed = packContext(
  [
    { label: "Rules", priority: 100, text: "Follow AGENTS.md. No schema changes." },
    { label: "Goal", priority: 95, text: "Fix parser bug in timezone handling." },
    { label: "Relevant Error", priority: 90, text: "Assertion failed in csv-parser.test.ts line 88." },
    { label: "Long Build Log", priority: 20, text: "...very long output..." },
  ],
  220
);

console.log(packed);
```

### 3) Decision log habit (Markdown template)
Use this after each major assistant run. It prevents context drift across sessions.

```md
# Decision Log (append-only)
- Date: 2026-03-17
- Task: Discord import parser
- Decision: Keep parser pure and map DB writes in route layer
- Why: Easier tests and fewer side effects
- Next prompt should include: parser rules + failing tests only
```

## Best Practices
1. Start every task with a short, explicit brief: goal, constraints, touched files, done criteria.
2. Keep stable instructions in one place (`AGENTS.md`/team rules) and reference them instead of retyping.
3. Send only relevant artifacts (specific file snippets, failing test output, exact error), not full dumps.
4. Maintain a running decision log so follow-up prompts inherit conclusions, not the whole conversation.
5. Re-anchor every few turns with "current state + next action" to prevent drift in long sessions.

## Common Pitfalls
**Pitfall**: Stuffing entire logs and many files "just in case."
**Solution**: Use a token budget and rank context by relevance/priority before each prompt.

**Pitfall**: Mixing stable rules with temporary instructions in ad-hoc chat text.
**Solution**: Keep durable rules in versioned instruction files, and keep task-specific details in a task brief.

**Pitfall**: Not capturing decisions, causing repeated loops in later sessions.
**Solution**: Append a 4-line decision entry after each milestone (decision, why, impact, next context).

## Related Topics
- Prompt compaction and rolling summaries
- Retrieval-first context selection (RAG for code)
- Prompt caching and prefix design for cost/latency
- Agent orchestration patterns (orchestrator-worker)
- Eval loops for assistant output quality

## Sources
- OpenAI: Conversation state — https://platform.openai.com/docs/guides/conversation-state
- OpenAI: Prompt caching — https://platform.openai.com/docs/guides/prompt-caching
- OpenAI: Prompt engineering — https://platform.openai.com/docs/guides/prompt-engineering
- Anthropic Engineering: Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
- Anthropic: Model Context Protocol — https://www.anthropic.com/news/model-context-protocol
- GitHub Docs: Repository custom instructions for Copilot — https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot
- Codebase references: `AGENTS.md`, `HANDOFF.md`, `.claude/commands/plan-out.md`, `.opencode/commands/research.md`, `/home/jared/.claude/CLAUDE.md`

## Follow-up Questions

---
*To continue learning, use: `/research more about Good habits for context management while using coding assistants` or ask follow-up questions*
