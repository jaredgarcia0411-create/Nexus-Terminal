# Agents Backup and Restore

Purpose: capture the Neon branch backup/restore flow for the Sprint 4 database state before migration 0019 and keep the operator verification steps explicit.

This is a manual ops runbook. It is meant to be copied by an operator, not executed by a Codex script.

Scope:
- Neon branch backup/export before a risky database change.
- Neon branch restore into a known-good branch or target.
- Operator-owned verification notes for a tested restore.

## 1. Backup model

For Sprint 4, treat the Neon branch as the backup artifact.

Keep the following values recorded when you create the backup:
- source project: `<neon-project-name>`
- source branch: `<source-branch-name>`
- source branch ID: `<source-branch-id>`
- backup time: `<iso-timestamp>`
- operator: `<operator-name-or-initials>`

Do not invent branch IDs or timestamps. If they are not known yet, leave the placeholder intact and fill it in later.

## 2. Create the backup branch

Before any migration or recovery experiment:

1. Open the Neon console for the project.
2. Confirm you are on the correct source branch.
3. Create a new branch from the current database state.
4. Record the new branch metadata in this file.
5. Save the connection string for the branch in the operator notes, not in the repo.

Suggested operator note block:

```text
Backup created:
- source branch: <source-branch-name>
- source branch ID: <source-branch-id>
- backup branch: <backup-branch-name>
- backup branch ID: <backup-branch-id>
- created at: <iso-timestamp>
```

## 3. Restore procedure

Use the backup branch to restore the database when the live branch needs to be reset or validated.

1. Open the Neon console and select the known-good backup branch.
2. Restore or clone that branch into the target branch you want to test.
3. Update the target `DATABASE_URL` outside the repo to point at the restored branch.
4. Confirm the restored branch is the one the app will use before any service restart.

If you need to restore into a fresh branch:
- Use a new branch name that makes the restore intent obvious.
- Keep the original backup branch untouched.
- Record both the source and target branch IDs in the operator notes.

Suggested operator note block:

```text
Restore target:
- backup branch: <backup-branch-name>
- backup branch ID: <backup-branch-id>
- restored branch: <restored-branch-name>
- restored branch ID: <restored-branch-id>
- restore time: <iso-timestamp>
```

## 4. Restore verification

After the restore, verify the branch is usable before calling it launch-ready.

Recommended checks:

```sh
psql "$DATABASE_URL" -c "SELECT id, status FROM agent_registry ORDER BY id;"
```

```sh
psql "$DATABASE_URL" -c "SELECT id, report_type, status FROM agent_reports ORDER BY created_at DESC LIMIT 5;"
```

```sh
psql "$DATABASE_URL" -c "SELECT id, agent_id, trigger_type, trading_date FROM agent_scheduled_runs ORDER BY created_at DESC LIMIT 5;"
```

Record what you observed:
- whether the expected Sprint 4 tables are present
- whether the seeded agent registry rows exist
- whether any unexpected rows, missing tables, or connection issues appeared

## 5. Operator-owned tested-restore verification

This section is intentionally outside the code-side Checkpoint 6 gate.

Use it to track the restore drill that the operator completes after handoff.

```text
Tested restore verification:
- status: <not run / passed / failed>
- run by: <operator>
- source branch ID: <source-branch-id>
- restored branch ID: <restored-branch-id>
- verification time: <iso-timestamp>
- notes: <verification-notes>
```

Rules:
- If a tested restore has not been run yet, say so explicitly.
- Do not claim launch readiness until the operator-owned restore verification is complete.
- Keep the note in this file rather than inventing a separate hidden record.

## 6. Aftercare

After the backup or restore task:
- Confirm the final branch IDs are recorded.
- Confirm the restore notes are readable by the next operator.
- Keep the placeholders if you do not know the exact IDs yet.
- Do not overwrite the backup branch with a restore test unless that is the explicit operator decision.

