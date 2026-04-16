---
name: research
description: Research a topic against the live codebase and relevant external sources. Save a markdown brief only when the user asks.
---

Use this as a read-first workflow. Do not change product code unless the user expands the task.

## Workflow

1. Resolve the topic and whether the user wants a saved artifact.
   - Ask for clarification only when the topic is missing or ambiguous.
   - Reuse an existing file in `.opencode/learn/` when the request is clearly a follow-up.
2. Build repo context before delegating.
   - Read `AGENTS.md` and `HANDOFF.md`.
   - Inventory the exact files, routes, hooks, tests, and docs that frame the topic.
   - Write down the 3-5 concrete questions the research needs to answer.
3. Decide whether delegation is worth it.
   - Use a local-only pass for narrow questions.
   - Use 1-3 subagents only when the topic is broad enough or the user explicitly wants parallel research.
   - Keep the first blocking read local.
4. Research with primary sources when needed.
   - Prefer local repo evidence for current behavior.
   - Use official docs or authoritative references for external facts.
   - Mark inferences clearly.
5. Save a brief only when requested.
   - Default path: `.opencode/learn/YYYY-MM-DD-topic-slug.md`
   - Reuse and extend an existing brief when appropriate.
6. Report back in chat.
   - Lead with the highest-signal findings, decisions, and risks.
   - Link the saved file when one was created.
   - Provide the full report in chat only when the user explicitly asks for it.

## Saved Brief Requirements

When a durable artifact is requested, include:

- The question and date
- A short executive summary
- Codebase findings with exact file references
- External findings with links
- Risks, open questions, and recommended next actions
- A source index

## Do Not

- Do not delegate by default.
- Do not create files unless the user asked for a durable artifact or a follow-up needs one.
- Do not dump the full report in chat unless the user explicitly asks for it.
- Do not skip repo grounding.
