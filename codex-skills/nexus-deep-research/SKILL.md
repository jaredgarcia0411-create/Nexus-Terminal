---
name: nexus-deep-research
description: >
  Run a deep research workflow for Nexus Terminal topics by grounding the question in the live
  codebase, optionally splitting research and review into parallel subagent passes when the task
  justifies it, and saving a structured markdown brief when the user explicitly asks for a saved
  artifact. Use when the user asks for deep research, a repo-aware investigation, a design/options
  memo, or a parallel multi-agent review tied back to this codebase.
---

# Nexus Deep Research

Use this as a read-first research skill. Do not change product code unless the user separately asks
for implementation work.

## Workflow

1. Resolve the topic and whether the user wants a saved artifact.
   - Only persist a markdown brief when the user explicitly asks to save, create a file, or keep a
     reusable artifact.
   - Default report path when saving: `docs/research/YYYY-MM-DD-topic-slug.md`.
   - Reuse and extend an existing report for the same topic when the user is asking for a follow-up
     pass rather than a brand-new memo.
2. Build local context before delegating.
   - Read `AGENTS.md` and `HANDOFF.md`.
   - Use `rg`, `find`, and targeted file reads to inventory the exact files, routes, hooks,
     schemas, tests, and docs that frame the topic.
   - Write down 3-5 concrete research questions that the final memo must answer.
3. Split the work into parallel passes only when delegation buys real signal.
   - Use local-only research for narrow questions that do not benefit from parallel work.
   - Use 2-3 subagents with disjoint scopes when the topic is broad enough or the user explicitly asks for delegation.
   - Keep the immediate blocking step local. Do not hand off the first thing you need in order to
     understand the problem.
   - While subagents run, continue gathering non-overlapping context locally and prepare the report
     skeleton or chat outline.
4. Synthesize findings.
   - Reconcile disagreements between passes.
   - Separate observed facts, inferences, and recommendations.
   - Tie every important conclusion back to specific repo files, code paths, or cited external
     sources.
5. Save the memo.
   - Only do this step when the user explicitly asked for a saved artifact.
   - Use `assets/research-report-template.md` as the section skeleton.
   - Create `docs/research/` if it does not exist.
   - Save the completed brief to the resolved report path.
6. Report back in chat.
   - Lead with the highest-signal findings, risks, and decisions.
   - Link the saved markdown file when one was created.
   - Call out what remains uncertain or unverified.

## Parallel Passes

Use the smallest split that still buys real signal. Do not delegate by reflex.

- Required 2-pass split for purely local topics:
  - Pass 1: codebase inventory and current behavior
  - Pass 2: skeptical review of risks, regressions, and missing tests
- Default 3-pass split when external research matters:
  - Pass 1: codebase inventory and current behavior
  - Pass 2: external docs, standards, or ecosystem options
  - Pass 3: skeptical review of risks, regressions, and missing tests
- Use 4 passes only when the topic is broad enough to justify separate implementation-option and
  reviewer tracks.

Read `references/subagent-patterns.md` before writing prompts for the delegated passes.

## Delegation Rules

- Use subagents only when the user asked for deep research, delegation, or parallel work.
- A local-only pass is valid when the topic is narrow or delegation would not materially help.
- If delegated passes would materially help but the environment cannot start subagents, report that
  blocker and continue locally only when the user still wants the degraded pass.
- Prefer `explorer` agents for read-only codebase investigation.
- Prefer the default agent type for browsing-heavy or synthesis-heavy passes.
- Keep write scopes empty. This skill is for research artifacts, not feature implementation.
- Pass file paths, raw diffs, URLs, and precise questions. Do not pass your intended answer.
- Tell each subagent to stay inside its assigned scope and return evidence, not just conclusions.
- Avoid immediate `wait_agent` calls. Let the delegated passes run while you keep moving locally.

## Sources

- Use local repo evidence first for any claim about current behavior.
- Browse primary external sources when the topic is time-sensitive, externally defined, or the user
  wants citations.
- Mark any inference that is not directly stated in a source.
- Prefer links and concise quotations over long copied passages.

## Memo Requirements

The saved markdown brief should let a future reader understand the question, the evidence, and the
current recommendation without reopening the entire chat.

- Include the question, date, and scope.
- Include a short executive summary.
- Include codebase findings with exact file references.
- Include external findings with links when external research was used.
- Include risks, open questions, and recommended next actions.
- Include a source index covering both repo files and external links.

## Do Not

- Do not make implementation changes unless the user explicitly expands the task.
- Do not spawn overlapping subagents that answer the same question twice.
- Do not treat assumptions as facts when the repo or the web can verify them.
- Do not save a report unless the user explicitly asked for an artifact.
- Do not save the report outside the repo unless the user asks for a different location.
