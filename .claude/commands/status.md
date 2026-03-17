Show me where we are on the current work.

## Process

### Step 1: Read project state

In parallel:
1. Read `HANDOFF.md` for active specs and their status
2. Run `git status` to see uncommitted changes
3. Run `git log --oneline -10` to see recent commits
4. Run `git diff --stat` to see what's changed since last commit

### Step 2: Summarize

Present a concise status report:

**Active Specs** (from HANDOFF.md):
- Spec name — status, acceptance criteria progress (e.g., "3/5 done")

**Uncommitted Changes:**
- List of modified/added files (or "clean" if nothing)

**Recent Commits:**
- Last 3-5 commits, one line each

**Next Steps:**
- What's the next thing to work on based on HANDOFF.md and current progress
- Any blockers or decisions needed

Keep it short. This is a "glance at the dashboard" command, not a deep analysis.
