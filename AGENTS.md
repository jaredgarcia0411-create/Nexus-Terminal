# Nexus Terminal

Next.js 15, React 19, TypeScript 5.9, deployed on Vercel.

## Stack
- Database: PostgreSQL via Neon, Drizzle ORM, schema in lib/db/schema.ts
- Auth: Google OAuth via NextAuth for login. Manual JWT (jose, HS256) for on-site sessions stored in httpOnly secure cookie
- State: useState + useEffect in app/page.tsx, localStorage fallback when DATABASE_URL unset
- Styling: Tailwind CSS v4, dark theme (#0A0A0B base, emerald-500 accent)
- Testing: Jest, run with npm test
- API routes: app/api/ — trades, tags, auth, schwab, health

## Rules
1. Preserve existing architecture. No refactors unless explicitly requested.
2. Run npm run lint, npx tsc --noEmit, npm test after every change.
3. Prefer modular code. No unnecessary dependencies.
4. Maintain TypeScript typing throughout.
5. Never modify .env, .env.local, or any secrets. Use environment variables only.
6. Do not log sensitive data. Do not commit secrets.

## Execution Workflow
1. Read HANDOFF.md for the current spec
2. Confirm plan before making changes
3. Implement in the exact order specified
4. Run lint, type-check, tests and report results
