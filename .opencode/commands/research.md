---
description: Research any topic and create structured crash courses. Combines web search, official docs, and codebase analysis. Always codebase-specific.
agent: build
---

Load the `research` skill and follow its workflow.

Command contract:
- `/research <topic>` starts new research.
- `/research more about <topic/aspect>` continues prior research when possible.
- If topic is missing, ask once: "What topic should I research?"

**Note**: Research is always codebase-specific (analyzes how the topic is used in your codebase).

Then follow the skill instructions exactly:
1. Show research plan before delegating (then proceed immediately without waiting for approval)
2. Choose delegation depth based on complexity (1-4 subagents); default to parallel when independent
3. Create crash course file in `.opencode/learn/`
4. Display the complete crash course in chat (full report, not summary)

For follow-ups (user says "tell me more" or asks questions about previous research):
1. Check `.opencode/learn/` for existing files
2. Load the relevant crash course
3. If follow-up is specific, proceed without clarification; only ask when ambiguous
4. Delegate focused subagent(s)
5. Append to existing file under "## Follow-up Questions"

Always save crash courses to `.opencode/learn/{topic-kebab-case}-{timestamp}.md`.
