---
description: Research a topic against the live codebase and relevant external sources. Save a crash course only when the user asks.
agent: executor
---

Load the `research` skill and follow its workflow.

Command contract:
- `/research <topic>` starts new research.
- `/research more about <topic/aspect>` continues prior research when possible.
- If topic is missing, ask once: "What topic should I research?"

Execution rules:
1. Build local repo context before delegating.
2. Delegate only when the topic is broad enough to justify parallel work.
3. Save a crash course in `.opencode/learn/` only when the user explicitly asks for a durable artifact or when extending an existing research file.
4. Default to concise findings in chat. If a file was saved, link it. If the user explicitly asks for the full report, provide it.
