# Nexus Terminal — Future Plans

Brainstorming and planned features captured across sessions so they don't get lost.

---

## Trade Journal Enrichment (from Notion Gap Analysis, 2026-03-25)

Nexus captures execution mechanics well (prices, quantities, MFE/MAE, exit efficiency) but lacks the qualitative trade analysis fields that drive improvement. These fields exist in Jared's Notion "Trading Second Brain" D1 Trade Log but aren't in Nexus.

### Option 1: Structured Fields — Add Notion columns to Nexus trades

Add 4 new fields to the `trades` table:

| Field | Type | Values |
|-------|------|--------|
| `grade` | select | A+, A, B+, B, C+, C, D, F |
| `setupType` | select | AH GAPPER, 7 AM GAPPER, 4 AM GAPPER, JOIN UP, INTRADAY PARA |
| `errors` | multi-select (JSON array) | EARLY ENTRY, LATE ENTRY, EARLY ADD, LATE ADD, EARLY COVER, LATE COVER, OVERSIZING, UNDERSIZING, NO TRIGGERS, MISSED TRIGGERS, TRADING P&L, FOLLOWED BLINDLY, MISSED ENTIRELY, DID NOT FIT, MISCLICK, TRAILED TOO TIGHT |
| `agenda` | multi-select (JSON array) | ATM, GTG S1, EQUITY LINE, INDUCEMENT, CASHLESS WARRANTS, ITM WARRANTS, ITM CONVERTS, DID NOT FIT |

**UI changes:**
- TradeDetailSheet gets new editable fields (dropdowns/multi-selects alongside notes)
- Performance tab gets new breakdowns: P&L by Setup Type, Most Common Errors, Grade Distribution, Performance by Agenda

**Why this matters:** Unlocks analytics that neither Notion nor current Nexus can do — e.g., "what's my win rate on ATM agenda trades?" or "how often does EARLY ENTRY cost me?"

**Effort:** ~2-3 sessions (schema migration, PATCH route update, UI for each field, new performance charts)

---

### Option 2: Full Journal Migration — Option 1 + Daily/Weekly Review in Nexus

Everything from Option 1, plus:

**Daily Review Card (DRC):**
- New DB table: `dailyReviews` (userId, date, followedProcess, riskedAccordingly, thoughts, goals, grossResult, netResult)
- Collapsible "Daily Review" section in JournalTab when expanding a day
- Questions match Notion DRC: Did I follow process? Did I risk accordingly? Missed trades? Thoughts? Goals?
- Chart upload/annotation support

**Weekly Review:**
- New DB table: `weeklyReviews` (userId, weekStart, weekEnd, rResults per day, whatWorked, whatDidnt, cycleNotes, goalsNextWeek)
- Section in Performance tab with auto-populated weekly R totals + reflection questions

**Additional trade fields:**
- `hodTime` — select (30-min buckets from 7:00 to 16:00) — when the name topped
- `lodTime` — select (same buckets) — when the name bottomed

**Why this matters:** Nexus fully replaces Notion for trading workflow. Reviews sit next to actual execution data.

**Effort:** ~4-5 sessions. Can be phased — do Option 1 first, then add reviews.

---

## Notes

- Option 1 is the recommended starting point — biggest analytical value for the effort
- Option 2 can layer on top later once Option 1 is in use and we know if Notion reviews should migrate
- The `tags` system already in Nexus could partially cover setup type and errors, but dedicated structured fields are better for analytics (consistent values, filterable, chartable)
- R-multiple tracking already works if `initialRisk` is set — consider a user-level default risk setting so it doesn't need to be entered per trade
