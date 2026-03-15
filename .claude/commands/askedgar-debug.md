Debug the AskEdgar research pipeline for: $ARGUMENTS

If no specific issue is given, run a full diagnostic of the pipeline.

## Diagnostic Steps

### 1. Check API Integration
- Read `lib/jarvis/askedgar.ts` — verify API client is correctly configured
- Read API docs at `docs/AE_API_DOCS.md` for expected endpoints and response formats
- Check that `ASKEDGAR_API_KEY` is referenced only server-side (never in client components)
- Verify base URL is `https://eapi.askedgar.io`

### 2. Check Research Pipeline
- Read `lib/jarvis/research.ts` — trace how research requests flow from API route to LLM
- Read `app/api/jarvis/research/route.ts` — verify the API route handles requests correctly
- Check error handling — what happens when AskEdgar API is down or returns errors?
- Check caching — are research_reports being stored and retrieved from the database?

### 3. Check Database Layer
- Read `lib/db/schema.ts` — verify `research_reports` table schema matches what the pipeline writes
- Check for any missing indexes on frequently queried columns (ticker, user_id, created_at)

### 4. Check Frontend Integration
- Find the component that displays research reports
- Verify it handles loading, error, and empty states
- Check that the research request is sent with correct parameters

### 5. Test the Flow
If possible, trace a single request end-to-end:
1. User requests research for a ticker
2. API route receives the request
3. AskEdgar API is called for filings
4. LLM processes the filings into a report
5. Report is cached in the database
6. Report is returned to the frontend

### 6. Common Issues to Check
- Rate limiting — is the AskEdgar API rate-limited? Are we handling 429 responses?
- Response parsing — are we correctly parsing the AskEdgar JSON response?
- Token limits — is the filing data too large for the LLM context window?
- Timeout — are research requests timing out on Vercel (10s limit on Hobby tier)?
- Circuit breaker — is `lib/jarvis/circuit-breaker.ts` tripping due to errors?

## Output
Report findings as:
- **Working**: What's functioning correctly
- **Broken**: What's failing and why
- **Missing**: What hasn't been implemented yet
- **Recommendations**: Next steps to fix or complete the pipeline

Include file paths and line numbers for all findings.
