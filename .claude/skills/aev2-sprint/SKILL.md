---
name: aev2-sprint
description: |
  Nexus Terminal's AEV2 (Agent Expansion V2) sprint workflow. Use this skill whenever the user is drafting, reviewing, amending, or finalizing an AEV2 sprint spec — including: planning the next sprint, writing or revising the active section of HANDOFF.md, fanning out subagents to review a sprint contract, collapsing a completed sprint, or preparing work for Codex to execute. Trigger on: "sprint", "handoff", "AEV2", "next sprint", "sprint N", "draft the spec", "fan out review", "review the sprint", "collapse the sprint", "ready for codex", "AEV2_PLAN", "AGENTIC_EXPANSIONV2", or any mention of the agent expansion roadmap. Also trigger when the user asks you to spawn subagents to critique a long sprint document.
---

# AEV2 Sprint Workflow

The AEV2 buildout is a multi-sprint effort to ship Nexus Terminal's multi-agent system (Orchestrator + Small Cap Trader + Swing Trader). Every sprint runs the same loop: **plan in Claude → execute in Codex → archive**. This skill captures that loop so you don't re-derive it every time.

---

## Hard Rules (Read First)

1. **Codex is the executor.** Every reference in a spec to the agent that will run the work must say "Codex". Do not use any other name for the executor in Sprint specs or HANDOFF.md.
2. **HANDOFF.md is the active contract.** Codex reads HANDOFF.md as the source of truth. It must contain the *current* sprint in full, plus collapsed summaries of completed sprints. No future sprints, no scratch notes, no half-drafts.
3. **Zero ambiguity bar.** Codex starts cold. If a spec has a question, missing path, or under-specified decision, Codex will either invent something or get stuck. Every file path, function name, env var, and decision must be explicit before you mark a sprint READY FOR CODEX.
4. **Verify paths before writing them.** Before referencing a file in a spec, confirm it exists (or is explicitly being CREATED). The recurring failure mode is the planner inventing a function or path that doesn't exist. Use Glob/Read to check.
5. **Don't bleed scope across sprints.** If something belongs to Sprint N+1, write it under "Out of scope" — don't sneak it into Sprint N because it's adjacent. Sprint boundaries exist to make Codex's job tractable.

---

## Inputs (Always Read First)

When the user asks you to draft, review, or amend an AEV2 sprint, read these in this order:

1. **`AEV2_PLAN.md`** — the full multi-sprint roadmap. Find the sprint you're working on. Use this for stories, scope, and dependencies.
2. **`AGENTIC_EXPANSIONV2.md`** — the source-of-truth design doc. This has the contracts, schemas, response shapes, formulas, and architectural decisions the spec must conform to. Anything in HANDOFF.md that conflicts with this is wrong.
3. **`HANDOFF.md`** — the current state. Look at:
   - What's already collapsed (so you don't duplicate it)
   - What the active sprint section currently says (so you know what to amend)
   - Whether the previous sprint is COMPLETE and ready to be collapsed
4. **`git log --oneline -- HANDOFF.md` (last ~10 commits)** — recent edits show what's been moving and what was just collapsed. Useful when the user says "what changed since yesterday".
5. **`.claude/CLAUDE.md`** — project-wide architecture rules and the lint/typecheck command.

If the user mentions a specific story (e.g., "AEV2-308"), grep `AEV2_PLAN.md` and `AGENTIC_EXPANSIONV2.md` for that ID first — the surrounding context usually tells you everything you need.

---

## The Sprint Loop

Sprint work breaks into four tasks. The user will tell you which one they're on; if it's ambiguous, ask.

### Task A — Draft a new sprint section

Use this when the previous sprint is COMPLETE and the user wants Sprint N+1 written into HANDOFF.md.

**Steps:**
1. Read all inputs above.
2. Identify the sprint number, title, and stories from AEV2_PLAN.md.
3. For each story, find the corresponding section in AGENTIC_EXPANSIONV2.md and pull out: contracts, types, function signatures, env vars, response shapes, error classes, retry semantics. **Inline them into the spec** — do not say "see AGENTIC_EXPANSIONV2.md §11", because Codex will not chase the reference reliably.
4. Verify every file path. For files being CREATED, mark them clearly. For files being MODIFIED, confirm they exist with Glob/Read first.
5. Lock decisions. Walk the spec and find every place where Codex would need to make a judgment call. Convert each into a "Decision" with a fixed answer. The Sprint 3 section's "Decisions Locked For Sprint 3" block is the format — use D1/D2/D3 numbering and explain *why* the choice was made so future-you can revisit it.
6. Write the spec into HANDOFF.md using the format below.
7. Set status to **READY FOR CODEX**.
8. Run `npm run lint && npx tsc --noEmit && npm test` to confirm the baseline is clean *before* Codex starts. Codex needs to know the starting state is green so any failures it sees are its own.

### Task B — Fan-out subagent review

Use this when the user says "review the sprint", "spawn subagents to review", "logically fan out", "audit the sprint contract", or any variant of "have multiple agents check this before Codex runs". This step is the highest-leverage one — it catches contract holes that one read-through misses.

**How to slice the work:** Don't have all subagents do the same thing. Partition by concern, not by file. Good slices:

| Subagent | Job |
|---|---|
| Contract auditor | Read AGENTIC_EXPANSIONV2.md and HANDOFF.md side by side. Flag every place the spec deviates from the design doc (missing field, wrong type, different env var name, etc.). |
| Path verifier | Take every file path the spec mentions. For CREATE files, confirm the parent directory exists. For MODIFY files, confirm the file exists and the function/section being modified is actually there. Report orphans. |
| Decision auditor | Walk the spec for unspecified behavior. Anywhere Codex would have to guess (error message text, log format, retry count, default value), flag it as a missing decision. |
| Scope creep checker | Read the previous sprint's "Out of scope" section and the current sprint's "In scope". Anything that should belong to a later sprint (Docker, Compose, prod hardening, scan blueprints, etc.) gets flagged. |
| Test coverage checker | For every new module/route, confirm there is a corresponding `__tests__/` entry in the spec. If a route has no test, that's a gap. |

**Spawn rules:**
- Send all subagents in **parallel** in a single message. Sequential fan-out wastes wall-clock and is the reason past sessions hit timeouts.
- Give each subagent the *exact* file paths to read and a one-line restatement of its concern. Don't make it re-discover the slice.
- Cap each subagent to the slice — tell it not to comment on anything outside its concern. This keeps reports terse.
- Ask for output in a fixed shape: `[Severity] [Location] — [Issue] — [Suggested fix]`.

After all subagents return, synthesize findings into a single amendment list (not 5 separate dumps). Group by severity. Then apply the amendments to HANDOFF.md and re-verify with a quick read-through.

### Task C — Amend the active sprint

Use this when the spec is already in HANDOFF.md but something needs to change (a decision flipped, a file path was wrong, Codex hit a contract hole mid-execution, etc.).

**Steps:**
1. Read the current HANDOFF.md sprint section.
2. Make the smallest possible diff. Don't rewrite the whole sprint — locate the specific decision/section/path that changed and edit just that.
3. If the change invalidates work Codex has already done, say so explicitly in a "Change Note" inside the amended section, with a date.
4. Keep status as **READY FOR CODEX** unless the change requires user signoff, in which case use **PENDING REVIEW** and flag it.

### Task D — Collapse a completed sprint

Use this when the user confirms a sprint is done and validated, and you need to shrink its section in HANDOFF.md.

**Steps:**
1. Confirm the sprint is actually complete: tests pass, lint passes, every acceptance criterion is checked off. If you can't confirm, ask the user.
2. Replace the full sprint section with the collapsed format below. Keep only Summary, Validation, and Archive Note.
3. Bump status to **COMPLETE**.
4. The detailed content (decisions, file actions, story breakdowns) is recoverable via `git log -- HANDOFF.md`. Don't try to keep both.

---

## HANDOFF.md Section Formats

### Active sprint format (use when status is READY FOR CODEX or IN PROGRESS)

```markdown
## AEV2 Sprint N — [Title]

> Generated: YYYY-MM-DD | Agent: Claude (Plan)
> Status: READY FOR CODEX

### Objective

[1–3 sentences. What this sprint delivers and how it sets up the next sprint. Be concrete — no marketing language.]

### Stories

- AEV2-NNN — [story title]
- AEV2-NNN — [story title]
...

### Current State

[Bullet list of what already exists, what doesn't, and what other files in scope/out-of-scope look like right now. This grounds Codex so it doesn't re-discover the world.]

### Scope

- **In scope:** [list of stories, file areas, route prefixes]
- **Out of scope:** [explicit list of things Codex must NOT touch this sprint, even if adjacent]

### Decisions Locked For Sprint N

These remove ambiguity before Codex starts. If any of them is wrong, update this section before execution — do NOT let Codex discover the ambiguity mid-sprint.

- **D1. [Topic].** [Decision and the reasoning that locked it.]
- **D2. [Topic].** [Decision and the reasoning that locked it.]
...

### Planned File Actions

**New files:**
- `path/to/file.ts` — [one-line purpose]
...

**Modified files:**
- `path/to/file.ts` — [what changes and why]
...

**Deleted files:**
- `path/to/file.ts` — [why it's being removed]
...

### Acceptance Criteria

- [ ] [Testable condition]
- [ ] [Testable condition]
...

### Validation

Run before marking the sprint COMPLETE:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- [Sprint-specific manual checks if any]
```

### Collapsed sprint format (use when status is COMPLETE)

```markdown
## AEV2 Sprint N — [Title]

> Generated: YYYY-MM-DD | Agent: Codex
> Status: COMPLETE

### Summary

- [3–6 bullets summarizing what was actually shipped, with links to the key files]

### Validation

- `npm run lint` OK
- `npx tsc --noEmit` OK
- `npm test` OK
- [Any sprint-specific checks]

### Archive Note

- The detailed [decisions / contracts / file actions] were intentionally removed from `HANDOFF.md` now that Sprint N is closed. Recover via `git log -- HANDOFF.md` if needed.
```

---

## Common Mistakes to Avoid

| Mistake | Why it bites | Fix |
|---|---|---|
| Referencing AGENTIC_EXPANSIONV2.md by section number | Codex will not chase references mid-task | Inline the contract/shape directly into the spec |
| Listing a file path without verifying it exists | Codex will either edit a phantom file or stall | Glob/Read every path before committing |
| Letting two sprints share the same module | Creates merge friction and unclear ownership | Hard partition: each sprint owns specific paths |
| Drafting Sprint N+1 while Sprint N is still IN PROGRESS in HANDOFF.md | Two READY-FOR-CODEX sections confuses Codex | Finish/collapse Sprint N first, then add Sprint N+1 |
| Skipping the fan-out review on a >300-line sprint | Single-pass review misses contract holes; user has explicitly asked for fan-out every sprint | Always run Task B before marking READY FOR CODEX on a non-trivial sprint |
| Forgetting to run lint/tsc baseline before Codex starts | Codex inherits a dirty baseline and blames itself | Always confirm green before handing off |
| Spawning subagents sequentially | Wall-clock blow-up; past sessions timed out doing this | All review subagents go in a single parallel message |
| Writing "TODO" or "TBD" anywhere in a READY sprint | Codex treats it as an instruction and either invents or stalls | Lock the decision or move it back to PENDING REVIEW |

---

## Quick Reference

**Files this skill expects to exist (verify if absent):**
- `/home/jared/Nexus-Terminal/AEV2_PLAN.md`
- `/home/jared/Nexus-Terminal/AGENTIC_EXPANSIONV2.md`
- `/home/jared/Nexus-Terminal/HANDOFF.md`
- `/home/jared/Nexus-Terminal/lib/agents/` — current AEV2 runtime modules
- `/home/jared/Nexus-Terminal/.claude/CLAUDE.md`

**Baseline commands (run before any handoff to Codex):**
```bash
npm run lint
npx tsc --noEmit
npm test
```

**Status values:**
- `PENDING REVIEW` — drafted but user hasn't signed off
- `READY FOR CODEX` — user signed off, Codex may start
- `IN PROGRESS` — Codex is working on it
- `COMPLETE` — all acceptance criteria checked, validation green, ready to collapse
