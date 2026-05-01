# FUTURE-PLANS.md

Parked ideas and longer-horizon plans. Each entry should note **why it's parked** and what would unblock it.

---

## Embed AskEdgar via iframe (parked 2026-05-01)

### The idea
Coworker suggested embedding the AskEdgar website inside Nexus Terminal's research tab via an `<iframe>`. The premise was:
- Share **one** AskEdgar subscription across the team
- Reduce our own API/build work since users would interact with AE directly
- Potentially replace the entire research tab

### Why it's parked
**AskEdgar's Terms of Service explicitly forbid the shared-subscription premise.**

Direct quotes from https://www.askedgar.io/legal/terms:
- > "Your account may only be used by one person. A single account shared by multiple people is not permitted."
- > "Each person must set up a new account for themselves."
- "Sharing logins" is listed as a suspension trigger.
- No bulk-download / scraping / programmatic access permitted.
- No redistribution without a separate written business license.
- No team/multi-seat plan in the standard ToS.

Going ahead with the original idea would put the account at risk of suspension. Not worth it.

### Technical feasibility (in case the legal side changes)
Checked 2026-05-01:
- `app.askedgar.io` returns no `X-Frame-Options` header and no `Content-Security-Policy` header.
- No CSP `<meta>` tag in the HTML.
- **Headers say embedding is allowed.** This could change at any time without notice.

Untested caveats — would need to verify with a real embed:
- Third-party cookie blocking (Chrome/Safari) often breaks login persistence inside cross-origin iframes.
- Next.js middleware can apply CSP per-route, so deep authenticated routes might behave differently than the login page.
- Cross-origin policy means we can't read iframe content, sync state, pre-fill searches, or extract data — it would be a visual passthrough only.

### Options to revisit later

1. **Each user buys their own AE subscription**, Nexus embeds AE purely as a UX convenience.
   - ToS-compliant.
   - Cuts our dev work on the AE replacement.
   - Costs each coworker a subscription.
   - Doesn't reduce our API calls if the current AE integration is server-side — it shifts load to AE's infra.

2. **Contact AskEdgar about a business / team license.**
   - Their ToS specifically mentions a "separate written business license agreement" exists.
   - A negotiated team rate for a handful of seats is plausible.
   - Lowest-risk path to making the original idea legitimate.
   - **Cheapest first step:** send an email before doing any technical work.

3. **Drop the iframe idea entirely, keep building the AE replacement in-house.**
   - No legal risk, no per-seat cost.
   - Keeps full dev burden on us.

### Triggers to revisit
- AE adds a public team/multi-seat plan.
- We get a response from AE on a business license.
- Our in-house AE replacement stalls and we need a faster path.

### What to check before acting
- Re-test `app.askedgar.io` headers — they may have added `X-Frame-Options` or CSP `frame-ancestors` since this was written.
- Re-read the [ToS](https://www.askedgar.io/legal/terms) — clauses change.
- Confirm our existing `lib/askedgar.ts` integration is still ToS-compliant (cached helpers, not bulk download).
