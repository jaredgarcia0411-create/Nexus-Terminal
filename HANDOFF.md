# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-16
> Purpose: brief summary of recently completed work. Older implementation detail lives in git history and `specs/`.

## Current State

No active execution spec is currently parked here. The most recent spec, **Agent Hardening #1 — Scope service chat GET authorization**, is completed below for traceability. Older shipped work is summarized under "Recently Completed" for context only.

## Agent Hardening #1 — Scope service chat GET authorization

> Generated: 2026-04-16 | Agent: nexus-architect
> Status: IMPLEMENTED (local validation complete; deploy spot-check still pending)

### Objective

The GET handler on `app/api/agents/service/chat/route.ts` currently returns any job to any caller who possesses a valid service key. This spec adds ownership enforcement: the caller must supply their `discord_user_id`, and the returned job must belong to that user in both the `job.userId` column and the `job.input.discord_user_id` field. Mismatches are silently collapsed to 404 (no existence leak).

### Current State

- `lib/validations/agents.ts` lines 12–14: `serviceChatGetQuerySchema` only requires `job_id`.
- `lib/agents/admin.ts` lines 8–27: `DISCORD_USER_MAP` is a private `const` used by `requireServiceAuth`. No helper exposes lookup by Discord user ID.
- `app/api/agents/service/chat/route.ts` GET handler (lines 102–228): validates `job_id`, checks the service key, loads the job, returns it — no ownership check.
- `services/discord-bot/index.ts` line 226: `pollChatJob(config, jobId)` takes only two parameters; `discordUserId` is not sent in the query string. `waitForTerminalState` (line 300) already holds `discordUserId` and calls `pollChatJob` at line 308.
- `__tests__/agent-service-chat-route.test.ts`: existing GET tests do not include `discord_user_id` in the URL, and job fixtures do not carry `input.discord_user_id` or `userId`.
- `logRouteError` signature (`lib/api-route-utils.ts` line 31): `logRouteError(route: string, error: unknown): void` — no metadata bag.

### Required Changes

#### Change 1 — Export `resolveDiscordUser` helper

**File:** `lib/agents/admin.ts`
**Action:** MODIFY

1. After the closing brace of `requireServiceKey` on line 92, append the following export. Do not modify any existing function.

```ts
export function resolveDiscordUser(discordUserId: string): AgentServiceUser | null {
  return DISCORD_USER_MAP[discordUserId] ?? null;
}
```

**Expected behavior after change:** Callers outside `admin.ts` can resolve a Discord user ID to an `AgentServiceUser` without duplicating or re-importing the map.

#### Change 2 — Extend the GET query schema

**File:** `lib/validations/agents.ts`
**Action:** MODIFY

1. Replace lines 12–14 (the `serviceChatGetQuerySchema` definition) with:

```ts
export const serviceChatGetQuerySchema = z.object({
  job_id: z.string().min(1),
  discord_user_id: z.string().min(1),
});
```

2. The inferred type `ServiceChatGetQueryInput` on line 16 updates automatically — no change needed there.

**Expected behavior after change:** A GET request missing `discord_user_id` returns `400 Validation failed` with `fieldErrors.discord_user_id` populated, before any auth or DB work happens.

#### Change 3 — Enforce ownership in the GET handler

**File:** `app/api/agents/service/chat/route.ts`
**Action:** MODIFY

1. On line 5, extend the named import from `@/lib/agents/admin` to include `resolveDiscordUser`:

```ts
import { requireServiceAuth, requireServiceKey, resolveDiscordUser } from '@/lib/agents/admin';
```

2. In the GET handler, locate the `db.select({ ... })` block that starts at line 113. Add `userId: agentJobs.userId` to the selected fields. The updated select object should be:

```ts
const [job] = await db.select({
  id: agentJobs.id,
  agentId: agentJobs.agentId,
  userId: agentJobs.userId,
  status: agentJobs.status,
  progressNote: agentJobs.progressNote,
  input: agentJobs.input,
  result: agentJobs.result,
  errorMessage: agentJobs.errorMessage,
  stepLog: agentJobs.stepLog,
})
  .from(agentJobs)
  .where(eq(agentJobs.id, queryState.data.job_id))
  .limit(1);
```

3. After the existing `if (!job)` block (lines 127–129) and before the `const input = readRecord(job.input)` line (currently line 131), insert the ownership check block:

```ts
const callerDiscordId = queryState.data.discord_user_id;
const mappedUser = resolveDiscordUser(callerDiscordId);
if (!mappedUser) {
  logRouteError('agents.service-chat.get', new Error('auth.mismatch'));
  return Response.json({ error: 'job not found' }, { status: 404 });
}

const inputRecord = readRecord(job.input);
const jobOwnerMatches = job.userId === mappedUser.id;
const inputDiscordMatches =
  typeof inputRecord.discord_user_id === 'string' &&
  inputRecord.discord_user_id === callerDiscordId;

if (!jobOwnerMatches || !inputDiscordMatches) {
  logRouteError('agents.service-chat.get', new Error('auth.mismatch'));
  return Response.json({ error: 'job not found' }, { status: 404 });
}
```

4. Replace the existing `const input = readRecord(job.input);` line below this block (used for `session_id` resolution) so it reuses the already-declared `inputRecord`:

```ts
// Replace: const input = readRecord(job.input);
// With:
const input = inputRecord;
```

**Expected behavior after change:**
- Unknown `discord_user_id` → 404, error logged.
- Known Discord user but job belongs to a different `userId` → 404, error logged.
- Known Discord user, correct `userId`, but `job.input.discord_user_id` differs → 404, error logged.
- All three mismatches log `[api:agents.service-chat.get] unhandled error Error: auth.mismatch` — no user IDs or job IDs in the error message.
- Legitimate caller with matching ownership passes through to existing response logic unchanged.

#### Change 4 — Pass `discord_user_id` in the bot's poll request

**File:** `services/discord-bot/index.ts`
**Action:** MODIFY

1. On line 226, update the `pollChatJob` function signature to accept `discordUserId` as a third parameter:

```ts
async function pollChatJob(config: BotConfig, jobId: string, discordUserId: string): Promise<ServiceJobState> {
```

2. After line 228 (`url.searchParams.set('job_id', jobId);`), add:

```ts
url.searchParams.set('discord_user_id', discordUserId);
```

3. On line 308 (inside `waitForTerminalState`), update the call to `pollChatJob` to pass `discordUserId`:

```ts
const state = await pollChatJob(config, jobId, discordUserId);
```

`discordUserId` is already a parameter of `waitForTerminalState` (line 302), so no further threading is needed.

**Expected behavior after change:** Every poll request to the GET endpoint includes `discord_user_id` in the query string, matching the Discord user who submitted the job.

#### Change 5 — Update and extend the test file

**File:** `__tests__/agent-service-chat-route.test.ts`
**Action:** MODIFY

1. In the `vi.hoisted` block (lines 6–17), add `resolveDiscordUserMock`:

```ts
const {
  randomUUIDMock,
  getAgentDbMock,
  ensureUserMock,
  requireServiceAuthMock,
  requireServiceKeyMock,
  resolveDiscordUserMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  getAgentDbMock: vi.fn(),
  ensureUserMock: vi.fn(),
  requireServiceAuthMock: vi.fn(),
  requireServiceKeyMock: vi.fn(),
  resolveDiscordUserMock: vi.fn(),
}));
```

2. Update the `vi.mock('@/lib/agents/admin', ...)` block (lines 23–26) to include the new export:

```ts
vi.mock('@/lib/agents/admin', () => ({
  requireServiceAuth: requireServiceAuthMock,
  requireServiceKey: requireServiceKeyMock,
  resolveDiscordUser: resolveDiscordUserMock,
}));
```

3. In the `beforeEach` block (lines 85–104), add a default mock return for `resolveDiscordUserMock` that returns a valid user matching `user-1`. Add this after `requireServiceKeyMock.mockReturnValue(null)`:

```ts
resolveDiscordUserMock.mockReturnValue({
  id: 'user-1',
  email: 'user@example.com',
  name: null,
  picture: null,
});
```

4. Update existing GET tests that construct a `Request` URL to include `&discord_user_id=discord-user-1`:

   - Line 173 (`'returns 400 on GET when the job_id query is missing'`): This test now gets 400 for both missing `job_id` AND missing `discord_user_id`. The assertion currently checks `fieldErrors.job_id` — that assertion still passes because `job_id` is still missing. No URL change needed; verify the assertion still holds after the schema extension.
   - Line 187: `'http://localhost/api/agents/service/chat?job_id=job-1'` → `'http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1'`
   - Line 198: same substitution
   - Line 275: same substitution
   - Line 299: same substitution
   - Line 325: same substitution
   - Line 355: same substitution
   - Line 387: same substitution
   - Line 420: `'http://localhost/api/agents/service/chat?job_id=missing-job'` → `'http://localhost/api/agents/service/chat?job_id=missing-job&discord_user_id=discord-user-1'`

5. Update every job fixture in the existing GET tests so `input` includes `discord_user_id: 'discord-user-1'` AND the fixture includes `userId: 'user-1'` (the DB select now reads `userId`):

   - "returns queued job state on GET" (line 264): add `userId: 'user-1'`; change `input: { session_id: 'session-1' }` to `input: { session_id: 'session-1', discord_user_id: 'discord-user-1' }`
   - "returns processing job state on GET" (line 288): same changes
   - "returns completed chat output on GET" (line 311): same changes
   - "returns routed specialist metadata on GET" (line 340): add `userId: 'user-1'`; change `input: {}` to `input: { discord_user_id: 'discord-user-1' }`
   - "returns specialist completion output on GET" (line 370): add `userId: 'user-1'`; change `input: { session_id: 'session-1' }` to `input: { session_id: 'session-1', discord_user_id: 'discord-user-1' }`
   - "returns failure details on GET" (line 404): add `userId: 'user-1'`; change `input: {}` to `input: { discord_user_id: 'discord-user-1' }`

6. Add the following three new negative tests after the existing "returns 404 on GET when the job is unknown" test (currently the last test, ending around line 443):

```ts
it('returns 400 on GET when discord_user_id query param is missing', async () => {
  const response = ensureResponse(
    await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1')),
  );
  const payload = await response.json();

  expect(response.status).toBe(400);
  expect(payload.error).toBe('Validation failed');
  expect(payload.details.fieldErrors.discord_user_id).toBeTruthy();
  expect(requireServiceKeyMock).not.toHaveBeenCalled();
});

it('returns 404 on GET when discord_user_id maps to a user but job.userId belongs to a different user', async () => {
  getAgentDbMock.mockReturnValueOnce(createGetDb({
    id: 'job-1',
    agentId: 'orchestrator',
    userId: 'user-OTHER',
    status: 'queued',
    progressNote: null,
    input: { discord_user_id: 'discord-user-1' },
    result: null,
    errorMessage: null,
    stepLog: [],
  }));

  const response = ensureResponse(
    await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')),
  );
  const payload = await response.json();

  expect(response.status).toBe(404);
  expect(payload).toEqual({ error: 'job not found' });
});

it('returns 404 on GET when discord_user_id matches job.userId but job.input.discord_user_id differs', async () => {
  getAgentDbMock.mockReturnValueOnce(createGetDb({
    id: 'job-1',
    agentId: 'orchestrator',
    userId: 'user-1',
    status: 'queued',
    progressNote: null,
    input: { discord_user_id: 'discord-user-DIFFERENT' },
    result: null,
    errorMessage: null,
    stepLog: [],
  }));

  const response = ensureResponse(
    await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')),
  );
  const payload = await response.json();

  expect(response.status).toBe(404);
  expect(payload).toEqual({ error: 'job not found' });
});
```

**Expected behavior after change:** All three new tests pass. All previously passing GET tests continue to pass with their updated fixtures and URLs.

### Files Changed Summary

| File | Action | ~Lines Changed | Risk |
|------|--------|----------------|------|
| `lib/agents/admin.ts` | MODIFY | +4 | LOW — additive export, no existing logic touched |
| `lib/validations/agents.ts` | MODIFY | +1 | LOW — schema addition; intentionally breaks callers that omit `discord_user_id` |
| `app/api/agents/service/chat/route.ts` | MODIFY | +18 | MEDIUM — ownership gate on production-facing auth path |
| `services/discord-bot/index.ts` | MODIFY | +3 | MEDIUM — bot polls will 400 until the route change ships with it |
| `__tests__/agent-service-chat-route.test.ts` | MODIFY | ~45 | LOW — test-only file |

**Deployment note:** The route and bot changes must be deployed together. If the route ships first without the bot update, the bot's polls will 400 until the bot is redeployed. If the bot ships first, the extra query param is ignored — harmless.

### Acceptance Criteria

- [x] `serviceChatGetQuerySchema` requires both `job_id` and `discord_user_id`
- [x] `resolveDiscordUser(discordUserId)` is exported from `lib/agents/admin.ts` and reuses `DISCORD_USER_MAP` without duplication
- [x] GET handler selects `userId` from `agentJobs`
- [x] GET handler calls `resolveDiscordUser` after the service key check
- [x] GET handler returns `404 { error: 'job not found' }` when `discord_user_id` is not in `DISCORD_USER_MAP`
- [x] GET handler returns `404 { error: 'job not found' }` when `job.userId !== mappedUser.id`
- [x] GET handler returns `404 { error: 'job not found' }` when `job.input.discord_user_id !== callerDiscordId`
- [x] All three mismatch paths call `logRouteError('agents.service-chat.get', new Error('auth.mismatch'))` — no user/job IDs in the Error message
- [x] `pollChatJob` in the bot accepts and sends `discord_user_id` as a query param
- [x] New negative test (a): missing `discord_user_id` → 400 passes
- [x] New negative test (b): `job.userId` mismatch → 404 passes
- [x] New negative test (c): `job.input.discord_user_id` mismatch → 404 passes
- [x] All pre-existing tests in `agent-service-chat-route.test.ts` still pass

### Verification Steps

Run these in order from the repo root:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run typecheck:services` (touches `services/discord-bot/index.ts`)
4. `npm test`
5. Manual spot-check after deploying route + bot together: trigger a `/nexus` command from a known Discord user, wait for the poll loop, confirm the reply arrives normally. Then `curl` the GET endpoint with a mismatched `discord_user_id` and confirm HTTP 404 + `{ "error": "job not found" }`.

### Next Up

Backlog items **#2 (prompt/context trust separation)** and **#3 (memory/retention TTL-on-read)** from `FUTURE-PLANS.md` are the immediate follow-ups once this spec ships and validates in prod. They are intentionally deferred to separate handoffs so each has its own focused scope.

## Recently Completed

### Agent Hardening Plan Refreshed

- The agent hardening backlog in `FUTURE-PLANS.md` was refreshed on `2026-04-16` after a repo-grounded deep research pass.
- The order of operations now emphasizes auth scoping first, then prompt/context trust separation and retention cleanup, then approval gates and spend enforcement, then dependency tracking, and only then a sandbox/sidecar boundary.

### Workflow Surfaces Rationalized

- On `2026-04-16`, the repo workflow surfaces were cleaned up to reduce drift and token bloat across Codex, Claude, and OpenCode docs.
- `AGENTS.md` is now the canonical workflow source; `HANDOFF.md` remains a summary file unless a new active execution spec is explicitly parked here.
- Claude hook guards were fixed to stop depending on `jq`, `MultiEdit` writes are now covered, service-local type-check requirements are explicit, OpenCode research and test-audit workflows were slimmed down, and the unrelated `Remi` persona was removed.
- A repo-local workflow drift check was also added as `npm run workflow:audit`.

Primary files touched:

- `AGENTS.md`
- `.claude/CLAUDE.md`
- `.claude/settings.json`
- `.claude/hooks/protect-env.sh`
- `.claude/hooks/migration-guard.sh`
- `.claude/hooks/typecheck.sh`
- `.claude/commands/create-agent.md`
- `.claude/commands/security-scan.md`
- `.opencode/agents/executor.md`
- `.opencode/commands/research.md`
- `.opencode/commands/test-auditor.md`
- `.opencode/skills/research/SKILL.md`
- `.opencode/skills/test-auditor/SKILL.md`
- `codex-skills/nexus-deep-research/SKILL.md`
- `scripts/workflow-audit.mjs`
- `package.json`

### Macro Daily Pipeline Shipped

- Phase 1 established the macro daily flow and follow-on planning (`2026-04-13`).
- Commit `fada1b0` added sentiment signals to the daily briefing, including prompt/context updates, a new `lib/agents/sentiment-client.ts`, and expanded agent/Discord coverage.
- Commit `0b33d6e` added daily deltas plus intraday macro updates through new orchestrator blueprints, config/context wiring, cron updates, and stronger regression coverage across the agent stack.

Primary files touched:

- `lib/agents/blueprints/orchestrator-macro-summary.ts`
- `lib/agents/blueprints/orchestrator-macro-intraday.ts`
- `lib/agents/discord.ts`
- `lib/agents/macro-cron.ts`
- `__tests__/agent-blueprints.test.ts`
- `__tests__/agent-discord.test.ts`

### Specialist News Pipeline Unified

- Commit `fbf04e4` centralized specialist news formatting through `lib/agents/news-formatter.ts`.
- Small-cap and swing-trader research blueprints were updated to use the shared path, with prompt adjustments and dedicated formatter tests added.
- Claude workflow docs were updated in the same pass and later re-rationalized during the workflow cleanup above.

Primary files touched:

- `lib/agents/news-formatter.ts`
- `lib/agents/blueprints/small-cap-research.ts`
- `lib/agents/blueprints/swing-trader-research.ts`
- `__tests__/news-formatter.test.ts`

### Discord Orchestrator Bot Cleanup

- Commit `e91d5a9` simplified the Discord bot response contract in `services/discord-bot/index.ts`.
- Routed requests now get a single plain reply: `Routed to specialist.`
- Direct orchestrator replies still render as embeds, but the visible session footer was removed.
- Failure and timeout handling stayed intact; the change was about reducing duplicate noise in `#orchestrator`.

Primary files touched:

- `services/discord-bot/index.ts`

### Repo-Managed Codex Skills Added

- Commit `2ca9a3d` added repo-maintained skills for status, debugging, review, security audit, and AskEdgar debugging workflows.
- `AGENTS.md` and this handoff were updated to point future agents at those repo-local skill sources.

Primary files touched:

- `codex-skills/nexus-status/`
- `codex-skills/nexus-debug/`
- `codex-skills/nexus-review/`
- `codex-skills/nexus-security-audit/`
- `codex-skills/nexus-askedgar-debug/`
- `AGENTS.md`

### Site-Native Agent Surface Planning Captured

- On `2026-04-16`, a repo-grounded architecture review captured the current agent messaging/report findings in `FUTURE-PLANS.md`.
- The planning note records that `agent_reports` is already the canonical persisted artifact, Discord is a transport/delivery layer rather than the source of truth, macro belongs on `Dashboard`, and agent-driven report work belongs in `Research`.
- The same note also records the recommended sequencing for a future execution spec: site-native macro/report surfaces first, then site-triggered job/status work, then in-site chat only after thread/session handling is tightened.

### Follow-Up Planning Captured Elsewhere

- Commit `b1be1d6` moved forward-looking work on agent hardening and the Hermes sidecar into `FUTURE-PLANS.md`.
- That planning remains intentionally separate from this handoff so `HANDOFF.md` stays focused on shipped work and the next active implementation spec when one is needed.

## Validation Snapshot

Current repo validation for workflow cleanup (`2026-04-16`):

- `npm run workflow:audit` — passed
- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm run typecheck:services` — passed
- `npm test` — passed (`46` files, `340` tests)

Most recent implementation-specific validation from the shipped Discord cleanup also included:

- `npx tsc --noEmit -p services/discord-bot/tsconfig.json` — passed
