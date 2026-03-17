Research and plan the following task: $ARGUMENTS

## Process

### Step 1: Research first — gather all context before planning

Before making ANY plan, launch subagents to gather context. Use the Agent tool to run these in parallel:

1. **Codebase exploration** (`subagent_type: "Explore"`) — Search for all files, functions, types, and patterns related to the task. Read the relevant source files. Understand the current implementation state.

2. **Architecture context** (`subagent_type: "nexus-architect"`) — Have nexus-architect review the current state of the area being planned. What exists? What's the current data flow? What are the constraints?

3. **External research** (if applicable) — If the task involves external APIs, libraries, or unfamiliar patterns, use a general-purpose agent to search docs or fetch relevant web pages.

Each subagent should return a structured summary:
- What they found (files, functions, types, patterns)
- Current state (what exists, what's missing)
- Constraints or risks they identified
- Any open questions

### Step 2: Synthesize findings

Once all research is complete, combine the findings into a single context document. Identify:
- **What exists** — files, functions, types already in place
- **What's missing** — gaps between current state and the goal
- **Dependencies** — what needs to happen first
- **Risks** — what could go wrong, what's fragile

### Step 3: Build the plan

Use the Agent tool with `subagent_type: "nexus-architect"` to create a detailed plan. Pass ALL the research findings as context. The plan should include:

1. **Goal** — one paragraph, plain language
2. **Current state** — what exists today (with file paths)
3. **Proposed approach** — high-level strategy
4. **Implementation phases** — ordered steps with:
   - Which files to touch
   - What changes to make
   - Why this order matters
5. **Open questions** — decisions that need my input before proceeding
6. **Risk assessment** — what could break, how to mitigate

### Step 4: Present the plan

Show me the plan in a clear format. Don't write it to HANDOFF.md yet — I want to review and approve first. If I approve, use `/handoff` to convert it into an executable spec.

Ask me about any open questions or decisions before proceeding.
