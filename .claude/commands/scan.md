Review the current conversation and capture durable lessons for future agents.

## Goal

Extract only concise, reusable guidance from this session and add it to `AGENTS.md` when it will improve future work.

## Process

### Step 1: Scan for durable lessons

Review the conversation, the files changed, and any mistakes or friction from the session.

Look for lessons such as:
- something the agent got wrong and should do differently next time
- repo knowledge or workflow knowledge that was missing but should have been known up front
- repeated instructions from the user that belong in standing guidance

### Step 2: Filter aggressively

Only keep notes that are:
- durable across future sessions
- specific enough to be actionable
- concise enough to fit naturally into `AGENTS.md`

Do not add:
- session-specific trivia
- temporary reminders
- narrative retrospectives
- duplicate rules that already exist

### Step 3: Update `AGENTS.md`

1. Condense overlapping lessons into a single rule.
2. Prefer short bullets over paragraphs.
3. Place each addition in the most relevant existing section.
4. If nothing durable was learned, leave `AGENTS.md` unchanged and say so.

### Step 4: Report

Report:
- what was added to `AGENTS.md`
- what you intentionally did not add because it was too specific or low value
