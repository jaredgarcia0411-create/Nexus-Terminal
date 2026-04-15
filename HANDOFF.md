# Nexus Terminal — HANDOFF.md

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail. Recently shipped: Macro Daily Phase 1 (2026-04-13), Phase 2 sentiment signals (`fada1b0`), Phase 3 deltas + intraday (`0b33d6e`), news pipeline unification (`fbf04e4`).

---

## Discord Orchestrator Bot — Single-Reply Cleanup

> Generated: 2026-04-15 | Agent: nexus-architect
> Status: IMPLEMENTED 2026-04-15 — AUTOMATED VALIDATION PASSED
> Scope: 1 file modified, 0 new files, 0 schema/migration changes, 0 new env vars, 0 new npm deps
> Dependency: none

### Objective

Make the Discord bot post exactly ONE message in `#orchestrator` per user message, and remove the visible session identifier (shown as a `Session …` footer today, which the operator perceives as a job id).

Two behaviors change:

1. **Routed path** — when the orchestrator routes a message to a specialist (e.g., `small-cap-trader`, `swing-trader`), the bot currently sends a "Routed to specialist — waiting for results..." message, then polls the specialist job for up to 2 minutes and sends a second message with either the specialist result embed or a "Research complete. Report delivered to the research channel." fallback. After this change: the bot sends ONE plain reply (`Routed to specialist.`) and stops. The specialist's own output still lands in whatever channel that agent posts to (e.g., small-cap or swing research webhooks) — it just stops being echoed back into `#orchestrator`.
2. **Non-routed path (orchestrator handled directly)** — the bot still posts ONE embed with the orchestrator's reply text, but the `Session {sessionId}` footer is removed.

Failure/timeout paths (submit failure, poll failure, orchestrator job failed, orchestrator job timed out) are unchanged.

### Observed Current State

- File: `services/discord-bot/index.ts` (547 lines, single file).
- `handleMessage()` at line 391 orchestrates the Discord → Nexus job flow.
- Routed branch lives at lines 433-474 inside `handleMessage`. It:
  1. Sends `'Routed to specialist — waiting for results...'` (line 434).
  2. Checks for `state.result.specialistJobId` (line 436-439); sends a second `'I could not track the specialist job.'` reply if null.
  3. Calls `waitForTerminalState(...)` for the specialist job (lines 441-445).
  4. On timeout → replyPlain `'Specialist did not finish within 2 minutes.'` (lines 447-450).
  5. On failed → replyPlain with failure class/message (lines 452-461).
  6. On completed with non-empty message → `replyCompleted(...)` embed (lines 463-469).
  7. Fallback → replyPlain `'Research complete. Report delivered to the research channel.'` (line 472).
- `buildCompletedEmbeds()` at lines 329-347 sets a `Session {sessionId}` footer on the first embed when a sessionId is provided (lines 341-343).
- `replyCompleted()` at line 349 takes `(message, responseText, sessionId)` and passes the sessionId through to `buildCompletedEmbeds`.
- `replyCompleted` is called from TWO places today:
  - Line 464 — inside the routed branch (will be removed).
  - Lines 476-480 — non-routed branch (must be updated to drop the third argument).
- No tests exist for this file today. `__tests__/agent-discord.test.ts` covers `lib/agents/discord.ts` (the embed builders on the API side), not the bot.

### Decisions Locked

- **D1. Hard-drop the specialist polling loop in the bot.** Specialists deliver their own reports via their own Discord webhooks. Echoing the specialist back into `#orchestrator` is duplicative noise. The operator asked for a single "routed / not routed" confirmation — that is the new contract.
- **D2. Remove the `sessionId` parameter entirely from `buildCompletedEmbeds` and `replyCompleted`.** Nothing else in the bot uses it after the footer is deleted, so keeping the parameter as dead weight would be code debt.
- **D3. Routed reply text: `'Routed to specialist.'`** — short, no target-agent name, no specialist job id, no session id. Keeps the orchestrator channel terse and predictable.
- **D4. Keep all failure/timeout/submit-error paths unchanged.** Those are already single-message replies and they surface real operational signal.

### Files To Modify

| File | Action | Notes |
|------|--------|-------|
| `services/discord-bot/index.ts` | Modify | Collapse routed branch to one plain reply; remove `sessionId` param chain; delete the `Session …` footer. |

No new files. No deletions. No schema, migration, env var, or npm dep changes.

### Ordered Work

**Step 1 — Delete the session footer in `buildCompletedEmbeds`.**

File: `services/discord-bot/index.ts`

Locate lines 329-347:

```ts
function buildCompletedEmbeds(
  responseText: string,
  sessionId: string | null,
): EmbedBuilder[] {
  const chunks = splitText(responseText, EMBED_DESCRIPTION_LIMIT);

  return chunks.map((chunk, index) => {
    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle(index === 0 ? 'Orchestrator Reply' : `Orchestrator Reply (${index + 1}/${chunks.length})`)
      .setDescription(chunk);

    if (index === 0 && sessionId) {
      embed.setFooter({ text: `Session ${sessionId}` });
    }

    return embed;
  });
}
```

Replace with:

```ts
function buildCompletedEmbeds(responseText: string): EmbedBuilder[] {
  const chunks = splitText(responseText, EMBED_DESCRIPTION_LIMIT);

  return chunks.map((chunk, index) => new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle(index === 0 ? 'Orchestrator Reply' : `Orchestrator Reply (${index + 1}/${chunks.length})`)
    .setDescription(chunk));
}
```

Behavior after: embeds have no footer. The `sessionId` parameter is gone from the function signature.

**Step 2 — Update `replyCompleted` to drop the sessionId parameter.**

Locate lines 349-359:

```ts
async function replyCompleted(message: Message<true>, responseText: string, sessionId: string | null) {
  const embeds = buildCompletedEmbeds(responseText, sessionId);
  const channel = message.channel as TextChannel;

  const [firstEmbed, ...remainingEmbeds] = embeds;
  await message.reply({ embeds: [firstEmbed] });

  for (const embed of remainingEmbeds) {
    await channel.send({ embeds: [embed] });
  }
}
```

Replace with:

```ts
async function replyCompleted(message: Message<true>, responseText: string) {
  const embeds = buildCompletedEmbeds(responseText);
  const channel = message.channel as TextChannel;

  const [firstEmbed, ...remainingEmbeds] = embeds;
  await message.reply({ embeds: [firstEmbed] });

  for (const embed of remainingEmbeds) {
    await channel.send({ embeds: [embed] });
  }
}
```

Behavior after: `replyCompleted` no longer accepts a third argument.

**Step 3 — Collapse the routed branch in `handleMessage` to a single plain reply.**

Locate lines 433-474 (the entire `if (state.result.routed) { ... }` block):

```ts
    if (state.result.routed) {
      await replyPlain(message, 'Routed to specialist — waiting for results...');

      if (!state.result.specialistJobId) {
        await replyPlain(message, 'I could not track the specialist job.');
        return;
      }

      const specialistState = await waitForTerminalState(
        config,
        message.author.id,
        state.result.specialistJobId,
      );

      if (specialistState.status === 'timeout') {
        await replyPlain(message, 'Specialist did not finish within 2 minutes.');
        return;
      }

      if (specialistState.status === 'failed') {
        const failureSuffix = specialistState.failureClass
          ? ` (${specialistState.failureClass})`
          : '';
        await replyPlain(
          message,
          `The specialist failed${failureSuffix}. ${specialistState.errorMessage ?? 'Please try again.'}`,
        );
        return;
      }

      if (specialistState.result.message.trim()) {
        await replyCompleted(
          message,
          specialistState.result.message,
          specialistState.sessionId ?? accepted.sessionId,
        );
        return;
      }

      await replyPlain(message, 'Research complete. Report delivered to the research channel.');
      return;
    }
```

Replace with:

```ts
    if (state.result.routed) {
      await replyPlain(message, 'Routed to specialist.');
      return;
    }
```

Behavior after: when the orchestrator routes the message to a specialist, the bot sends one reply (`Routed to specialist.`) and `handleMessage` returns. No specialist polling, no second message.

**Step 4 — Update the non-routed `replyCompleted` call.**

Locate lines 476-480 (immediately after the deleted routed branch):

```ts
    await replyCompleted(
      message,
      state.result.message,
      state.sessionId ?? accepted.sessionId,
    );
```

Replace with:

```ts
    await replyCompleted(message, state.result.message);
```

Behavior after: the non-routed branch still renders the orchestrator's reply text as an embed, but without the session footer.

**Step 5 — Verify no now-unused variables linger.**

After steps 3 and 4, the local `accepted.sessionId` path is no longer read anywhere in `handleMessage`. The `accepted` constant itself is still needed (line 405) because `accepted.jobId` is passed to `waitForTerminalState` on line 412 for the orchestrator job. Do NOT remove `accepted` or change the `submitChatJob` return shape. Just confirm that `accepted.sessionId` has no remaining reader in the file.

Also confirm no imports become unused:

- `EmbedBuilder` — still used in `buildCompletedEmbeds`. Keep.
- `TextChannel` — still used in `replyCompleted`. Keep.
- All other imports at lines 1-10 remain in use.

**Step 6 — Validate.**

Run from the repo root:

1. `npm run lint`
2. `npx tsc --noEmit`

If the top-level `npx tsc --noEmit` does not type-check files under `services/`, additionally run:

3. `npx tsc --noEmit -p services/discord-bot/tsconfig.json`

All three (or the two that apply) must complete with zero errors.

### Execution Status

Automated validation completed on 2026-04-15:

1. `npm run lint` — passed
2. `npx tsc --noEmit` — passed
3. `npx tsc --noEmit -p services/discord-bot/tsconfig.json` — passed
4. `npm test` — passed (`46` files, `340` tests)

### Acceptance Criteria

- [ ] `services/discord-bot/index.ts` is the only file changed.
- [ ] `buildCompletedEmbeds` signature is `(responseText: string) => EmbedBuilder[]` — no `sessionId` parameter.
- [ ] `buildCompletedEmbeds` no longer calls `embed.setFooter(...)` anywhere.
- [ ] `replyCompleted` signature is `(message: Message<true>, responseText: string) => Promise<void>` — no `sessionId` parameter.
- [ ] In `handleMessage`, the `if (state.result.routed)` branch contains exactly two statements: `await replyPlain(message, 'Routed to specialist.');` and `return;`.
- [ ] No reference to `specialistJobId`, `specialistState`, or the strings `'waiting for results'`, `'Research complete'`, `'Specialist did not finish'`, `'The specialist failed'`, `'I could not track the specialist job.'` remains anywhere in `services/discord-bot/index.ts`.
- [ ] The non-routed branch calls `replyCompleted(message, state.result.message);` with exactly two arguments.
- [ ] `waitForTerminalState` is still called once (for the orchestrator job at line ~412). It is NOT called a second time for any specialist job.
- [ ] Submit-failure, poll-failure, job-failed, and job-timeout paths are byte-for-byte unchanged.
- [ ] `npm run lint` passes.
- [ ] `npx tsc --noEmit` passes (and `npx tsc --noEmit -p services/discord-bot/tsconfig.json` if it applies).

### Files Changed Summary

| File | Lines Added | Lines Removed | Risk |
|------|-------------|---------------|------|
| `services/discord-bot/index.ts` | ~10 | ~50 | Low |

Net deletion of ~40 lines. Pure simplification — no new branches, no new dependencies, no type surface growth.

### Verification Steps

**Automated:**

1. `npm run lint` — must pass.
2. `npx tsc --noEmit` — must pass.
3. If top-level tsc does not cover the services directory: `npx tsc --noEmit -p services/discord-bot/tsconfig.json`.

**Manual (smoke test, after deploying the bot):**

1. In `#orchestrator`, send a message that should be routed to a specialist (e.g., a small-cap ticker research request). Confirm: exactly ONE bot reply arrives in `#orchestrator` reading `Routed to specialist.`. The specialist's actual research output arrives in its own channel (small-cap or swing research webhook) and NOT in `#orchestrator`.
2. In `#orchestrator`, send a message that the orchestrator handles directly (e.g., a general question that does not match the small-cap/swing classifier). Confirm: exactly ONE embed reply arrives with the orchestrator's text, and the embed has no `Session …` footer.
3. Send an empty message (or trigger a submit failure by stopping the Nexus API). Confirm the relevant error reply still arrives as a single plain message (unchanged behavior).

### Out Of Scope

- Do NOT add a `!health` / `/health` / `/status` command or any admin-stats integration. That is a separate future task — the orchestrator classifier today only routes to `small-cap-trader` / `swing-trader`, so typing "give me system health" would fall through to the LLM with no tool access to `/api/agents/admin/stats`.
- Do NOT touch `app/api/agents/**` or any file outside `services/discord-bot/index.ts`.
- Do NOT rename helpers, reorder imports, or introduce new abstractions. Keep the change surgical.

### Security Notes

- No secrets touched. No new env vars. No new network calls.
- Removing the `Session …` footer actually reduces information disclosure in the Discord channel (session ids are opaque but were visible to anyone in `#orchestrator`).

### Complexity

Low. Four localized edits in a single file, all deletions or signature simplifications. No new code paths, no schema changes, no new tests required (the file has no existing test coverage and this change does not warrant adding one — the behavior is trivially verifiable by running the bot against Discord).

---

## Session Maintenance Checklist

- [ ] After Codex finishes this spec, commit with a message referencing the single-reply cleanup.
- [ ] Smoke-test both routed and non-routed paths in `#orchestrator` per Verification Steps above.
- [ ] If a future task adds a `/health` Discord command, note that `/api/agents/admin/stats` already returns the full payload (agent heartbeats, queue depth, stuck jobs, today's request count / cost / success rate, circuit breakers, delivery failures) and requires `AGENT_ADMIN_KEY` — not the service key the bot uses today.
- [ ] Sync the new repo Codex skills (`nexus-status`, `nexus-debug`, `nexus-review`, `nexus-security-audit`, `nexus-askedgar-debug`) into `~/.codex/skills/` and restart Codex if you want them surfaced in the skill list.
