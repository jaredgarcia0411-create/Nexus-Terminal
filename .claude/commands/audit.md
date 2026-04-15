Audit documentation, memory, and skills against the actual codebase to find drift: $ARGUMENTS

If $ARGUMENTS specifies a focus area (e.g., "CLAUDE.md", "memory", "skills"), only audit that area. Otherwise, audit everything.

## Step 1: Launch parallel Explore agents

Launch up to 3 Explore agents in parallel using the Agent tool. Each agent should return a structured list of discrepancies found.

### Agent 1: CLAUDE.md + HANDOFF.md audit

Check `/home/jared/Nexus-Terminal/.claude/CLAUDE.md` against reality:
- **Counts**: Run `find app/api -name route.ts | wc -l` and compare to the route count in CLAUDE.md. Count tables in `lib/db/schema.ts` and compare to the table count. Count files in `hooks/` and check if a count is claimed.
- **File existence**: Every file path mentioned in CLAUDE.md — verify it exists. Flag any that don't.
- **Module lists**: Check exports from `lib/indicators.ts`, files in `lib/parsers/`, files in `lib/discord/`, files in `lib/validations/` — compare to what CLAUDE.md lists.
- **Stack versions**: Check `package.json` versions for Next.js, React, TypeScript, Drizzle, NextAuth against CLAUDE.md claims.
- **Tab mapping**: Compare tab keys and order in `app/page.tsx` to the CLAUDE.md table.
- **Env vars**: Search for `process.env.` references across the codebase and compare to the env vars table.
- **Known issues**: Check if listed known issues are still accurate.

Check `HANDOFF.md` if it exists:
- Are any "remaining" tasks actually completed? Check git log for commits that mention the task items.
- Are there fix/priority sections for bugs that have already been resolved?

### Agent 2: Memory files audit

Check all files in `/home/jared/.claude/projects/-home-jared-Nexus-Terminal/memory/`:
- Read `MEMORY.md` index — does every linked file exist? Are there memory files not in the index?
- Read each memory file — check for:
  - References to files that don't exist (wrong filenames, deleted files)
  - Claims about code state that can be verified (line counts, function names, feature existence)
  - "Locked" decisions that contradict referenced spec documents
  - Descriptions that no longer match the file content
- Check for redundancy between memory files, CLAUDE.md, PRD.md, and global `~/.claude/CLAUDE.md`

### Agent 3: Skills, commands, and agents audit

Check all files in:
- `/home/jared/Nexus-Terminal/.claude/commands/`
- `/home/jared/Nexus-Terminal/.claude/skills/`
- `/home/jared/Nexus-Terminal/.claude/agents/`
- `/home/jared/.claude/commands/` (global)
- `/home/jared/.claude/agents/` (global)

For each file:
- Does it reference functions, files, or patterns that exist in the codebase? (e.g., if a skill says "check `auth()` from `lib/auth-config`", verify that's the actual auth pattern)
- Are there duplicate commands at global and project scope? If so, are they identical?
- Are there orphan files (`.save`, empty dirs, backup files)?
- Do agent definitions reference tools or subagents that exist?

Also check:
- `/home/jared/.claude/agent-memory/` and `/home/jared/Nexus-Terminal/.claude/agent-memory/` for empty or orphaned directories

## Step 2: Compile report

Combine all agent findings into a single report organized by severity:

### Report format

```
## Audit Report — [date]

### Critical (causes errors or wrong behavior)
- [item]: [what's wrong] → [what it should be]

### Medium (misleading but not breaking)
- [item]: [what's wrong] → [what it should be]

### Low (cosmetic or minor)
- [item]: [what's wrong] → [what it should be]

### Clean (no issues found)
- [list of areas that checked out fine]
```

## Step 3: Suggest fixes

For each discrepancy, state the exact fix:
- File path
- What to change (old → new)
- Whether it's safe to auto-fix or needs user input

Ask the user: "Want me to apply these fixes?"

## Rules

- This is a READ-ONLY audit. Do not edit any files unless the user approves fixes in Step 3.
- Do not guess at correct values — verify by reading actual files and running actual commands.
- If a count or claim can't be verified programmatically, say so rather than assuming it's correct.
- Flag stale information (references to completed work, old plans, superseded specs) even if technically not "wrong."
- Keep the report concise — one line per finding, not paragraphs.
