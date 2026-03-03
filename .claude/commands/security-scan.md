Perform a security vulnerability scan on the codebase, focusing on: $ARGUMENTS

If no specific focus is given, scan the entire project.

## Scan Categories

### 1. Authentication & Authorization
- Verify all API routes (`app/api/**`) call `auth()` from `@/lib/auth-config` and reject unauthenticated requests
- Check that middleware protects all non-public routes
- Ensure JWT tokens are not exposed to client-side code
- Verify `ALLOWED_EMAILS` env var is respected in all auth flows
- Check for session fixation or token reuse vulnerabilities

### 2. Injection Attacks
- **SQL Injection**: All database queries in `lib/db.ts` and API routes must use parameterized queries (`args: [...]`), never string interpolation
- **XSS**: Check for `dangerouslySetInnerHTML`, unescaped user input rendered in JSX, or raw HTML responses
- **Command Injection**: Check for `exec()`, `spawn()`, or shell commands using user input
- Look at the Schwab OAuth callback for HTML injection in the popup response

### 3. Secrets & Environment Variables
- `.env.local` must be in `.gitignore`
- No hardcoded secrets, API keys, or tokens in source code
- `NEXTAUTH_SECRET` is set and sufficiently random
- Schwab tokens in DB are never returned to the client
- No secrets logged via `console.log` or `console.error`

### 4. API Security
- Rate limiting considerations on public-facing endpoints
- CSRF protection (NextAuth handles this, but verify custom routes)
- Proper HTTP status codes for auth failures (401/403, not 200 with error)
- Input validation on all API route parameters (query params, request body)
- File upload validation (CSV import): check file size limits, content type

### 5. Client-Side Security
- No sensitive data stored in localStorage (tokens, secrets)
- `postMessage` listeners validate origin (check Schwab OAuth popup)
- External links use `rel="noopener noreferrer"`
- CSP headers configured if applicable

### 6. Dependency Vulnerabilities
- Run `npm audit` mentally — flag any known vulnerable packages
- Check for outdated packages with known CVEs
- Verify no unnecessary dependencies (e.g., `firebase-tools` if unused)

## Output Format

For each finding:
- **Severity**: Critical / High / Medium / Low / Info
- **Category**: Which scan category above
- **Location**: File path and line number
- **Issue**: Description of the vulnerability
- **Proof**: How it could be exploited
- **Fix**: Specific code change to remediate

Summarize with a count of findings per severity level.
