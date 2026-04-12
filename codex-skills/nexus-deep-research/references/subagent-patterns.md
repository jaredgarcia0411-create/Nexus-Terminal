# Parallel Research Patterns

Use this file when deciding how to split a deep-research request into parallel passes.

Every invocation of this skill should use parallel subagents. The only question is how many passes
to run and what each pass owns.

## Default Split

Use the 2-pass split for purely repo-local topics. Use the 3-pass split when external research is
material to the answer.

1. Codebase pass
   - Goal: map current behavior, relevant files, constraints, and live patterns.
   - Good agent type: `explorer`
2. Review pass
   - Goal: challenge the likely answer, find regressions, missing tests, or bad assumptions.
   - Good agent type: `explorer`

## Three-Pass Split

1. Codebase pass
   - Goal: map current behavior, relevant files, constraints, and live patterns.
   - Good agent type: `explorer`
2. External pass
   - Goal: gather primary-source docs, standards, libraries, or ecosystem comparisons.
   - Good agent type: `default`
3. Review pass
   - Goal: challenge the likely answer, find regressions, missing tests, or bad assumptions.
   - Good agent type: `explorer` or `default`, depending on whether browsing is needed

## Prompt Patterns

Use prompts like these, then replace the placeholders with the live topic and scope.

### Codebase pass

`Investigate how this repo currently handles <topic>. Limit scope to current behavior, relevant files, constraints, and notable gaps. Return file paths and concise findings only.`

### External pass

`Research primary external sources relevant to <topic>. Focus on current docs, standards, or options that matter for this repo. Return links, dates when relevant, and concrete implications.`

### Review pass

`Review <topic> as a skeptical reviewer. Focus on risks, regressions, edge cases, and missing tests or assumptions. Tie concerns back to this repo where possible.`

## Wait Discipline

- Do not block on subagents before finishing your own first-pass reading.
- Wait when the next synthesis step actually depends on the delegated result.
- If one pass is clearly lagging and the memo can proceed without it, note the gap and continue.
- If the environment cannot start the required parallel subagents at all, stop and report the
  blocker rather than faking a complete deep-research run.

## Evidence Standard

- Ask each subagent for concrete evidence, not just a summary.
- Prefer file paths, function names, tests, URLs, and dates.
- Ask for uncertainty to be stated explicitly.
