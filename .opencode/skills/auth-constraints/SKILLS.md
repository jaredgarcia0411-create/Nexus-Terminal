---
name: auth-constraints
description: Load this skill when any change touches authentication, sessions, OAuth, JWT, cookies, or API route protection.
---

## Auth Has Two Surfaces

### Google OAuth (NextAuth)
- Handles login only
- Any changes here are elevated risk
- Do not move session management into NextAuth

### On-Site Session Auth (manual JWT)
- Implementation: lib/auth.ts
- Functions: createSession, getSession, deleteSession
- Strategy: HS256 via jose
- Storage: httpOnly secure cookie, 24h expiry
- Do not suggest NextAuth for this layer
- Do not replace jose with any other JWT library

### Username/Password Auth (planned)
- Extend users table with nullable password_hash and google_id columns
- Use argon2 for password hashing — do not use bcrypt or MD5
- Registration, login, and password reset routes go under app/api/auth/
- Both Google and password auth must call createSession() from lib/auth.ts
- One users table record per user regardless of auth method

## API Route Protection
- Protected routes must call getSession() from lib/auth.ts
- Return 401 if session is null — do not redirect from API routes
- New API routes follow the domain structure: app/api/[domain]/route.ts
- Future broker routes go under app/api/brokers/[broker]/
- Future market data routes go under app/api/market/
- Future analytics routes go under app/api/analytics/

## Do Not
- Do not suggest NextAuth for session management
- Do not store tokens in localStorage or non-httpOnly cookies
- Do not log JWT secrets or credentials
- Do not create top-level API routes for broker integrations
- Do not create a separate users table for password auth — 
  extend the existing users table with nullable password_hash 
  and google_id columns
