# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

### Session Maintenance Checklist
- [x] Review `AGENTIC_EXPANSIONV2.md` and replace `AEV2_REVISIONS.md` with a literal pre-sprint edit script for the next spec pass
- [x] Apply `AEV2_REVISIONS.md` to `AGENTIC_EXPANSIONV2.md` and rename the spec file from `AGENTIC_EXPANSION_V2.md`
- [x] Run the post-patch cleanup sweep on `AGENTIC_EXPANSIONV2.md`
- [x] Refresh `AEV2_REVISIONS.md` with sprint-board blockers, launch blockers, and locked routing/service-route decisions from the latest review
- [x] Convert `AEV2_REVISIONS.md` from redline checklist into a literal section-by-section patch plan for the next spec pass
- [x] **Execute R6 consolidation pass on AGENTIC_EXPANSIONV2.md** (this handoff)
- [x] Draft a tight pre-sprint blocker patch checklist in `HANDOFF.md` from the latest AGENTIC_EXPANSIONV2 review
- [x] Expand the blocker checklist into an exact section-by-section patch plan with replacement targets
- [x] Execute the pre-sprint blocker patch plan on `AGENTIC_EXPANSIONV2.md`
- [x] Draft `AEV2_DRAFT.md` with initiative/epic/story/sprint breakdown for `AGENTIC_EXPANSIONV2.md`
- [x] Execute codebase cleanup spec, including Research tab visual validation

---

## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)

Minor follow-ups from the 2026-03-29 review; none block sprint import.
- **R8:** Deduplicate repeated `step_log` guidance; replace the duplicate with a cross-reference to Section 3.2.
- **R9:** Keep “multi-agent fanout deferred to V2” only in the Executive Summary and Section 13 closing note; trim the other repeats to cross-references.
- **R10:** Make Section 20 Discord Adapter reference Section 13 for the 120s/60-attempt polling timeout instead of restating it.
- **M2:** Clarify in Section 19 that the budget is enforced per-agent, so `$5/day` across 3 agents means `$15/day` total.
- **M3:** Add `idempotencyKey: 'swing-research-{ticker}-{date}'` to `swing:research` step 6 metadata.
- **M4:** State that Vercel routes use `getDb()` from `lib/server-db-utils.ts` and Docker workers use `getAgentDb()` from `lib/agents/db.ts`; never mix them.
- **B11:** Add `chat-helpers.ts` and `historical-summary.ts` to the Phase 7 delete list in Section 18.
- **B15/B18:** Audit existing `services/discord-bot/` contents before Phase 5 Step 44, and define `services/.env.example` from Docker Compose `environment:` blocks.
