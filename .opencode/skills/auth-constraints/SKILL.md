---
name: auth-constraints
description: Load this skill when any change touches authentication, sessions, OAuth, JWT, cookies, or API route protection. Contains Nexus Terminal's secure API route patterns.
---

## Core Authentication Patterns

### 1. Secure API Route Template
**All protected API routes must follow this exact pattern:**

```typescript
// 1. Check authentication
const authState = await requireUser();
if ('error' in authState) return authState.error;

// 2. Get database connection
const db = getDb();
if (!db) return dbUnavailable();

// 3. Ensure user exists in database (upsert)
await ensureUser(db, authState.user);

// 4. Parse + validate JSON body for POST/PATCH/PUT/DELETE
const bodyState = await parseAndValidate(request, yourZodSchema);
if (bodyState.error) return bodyState.error;
const body = bodyState.data;

// 5. Wrap operations in try/catch with proper error handling
try {
  // 6. Always scope database operations by userId
  // Example: eq(trades.userId, authState.user.id)
  
  // Your database operations here...
  
  // 7. Return success response
  return Response.json({ /* your data */ });
} catch (error) {
  logRouteError('route.name', error);
  return internalServerError();
}
```

### 2. Auth Function Patterns

**`requireUser()`** (from lib/server-db-utils.ts):
- Returns either `{ error: Response }` or `{ user: AuthUserIdentity }`
- Validates user has `id` and `email`
- Returns 401 Response if unauthorized

**`ensureUser(db, user)`**:
- Upserts user into database with conflict resolution
- Updates name/picture if changed from OAuth provider

**`AuthUserIdentity` interface**:
```typescript
export interface AuthUserIdentity {
  id: string;      // Required
  email: string;   // Required  
  name: string | null;
  picture: string | null;
}
```

### 3. Database Connection Patterns

**Two database clients**:
- `getDb()` - HTTP-based for reads/single writes (use for most operations)
- `getPoolDb()` - Pool-based for transactional/bulk writes (use for imports, bulk updates)

**Always check database availability**:
```typescript
const db = getDb();
if (!db) return dbUnavailable(); // Returns 503 response
```

### 4. Error Handling Patterns

**Route-level error handling**:
- `logRouteError(route: string, error: unknown)` - logs to console with route context
- `internalServerError()` - returns standardized 500 response
- `dbUnavailable()` - returns standardized 503 response when DB not configured

**JSON parsing + validation**:
```typescript
const bodyState = await parseAndValidate(request, yourZodSchema);
if (bodyState.error) return bodyState.error; // Returns 400 for invalid JSON or validation failure
const body = bodyState.data; // Fully typed from the Zod schema
```

**Common error responses**:
```typescript
// Unauthorized
Response.json({ error: 'Unauthorized' }, { status: 401 });

// Bad request  
Response.json({ error: 'Missing required fields' }, { status: 400 });

// Not found
Response.json({ error: 'Trade not found' }, { status: 404 });

// Conflict (duplicate, constraint violation)
Response.json({ error: 'Resource already exists' }, { status: 409 });
```

### 5. User Scoping Patterns

**All database queries MUST include userId filter**:
```typescript
// Single entity
.where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))

// Multiple entities
.where(eq(trades.userId, authState.user.id))

// Many-to-many relationships
.where(and(
  eq(tradeTagsTable.userId, authState.user.id),
  eq(tradeTagsTable.tradeId, id),
))
```

**Composite primary keys**:
- All user-scoped tables use `(userId, id)` composite PK
- Use for upsert targeting: `target: [trades.userId, trades.id]`

### 6. Response Patterns

**Success responses**:
```typescript
// Single entity
Response.json({ trade: tradeData });

// Multiple entities  
Response.json({ trades: tradeList });

// Success flag
Response.json({ success: true, name: tagName });
```

**Error responses always follow**:
```typescript
Response.json({ error: 'Descriptive message' }, { status: 400 });
```

### 7. Route Structure Patterns

**Public routes (no auth required)**:
- `/api/health` - health check endpoint
- `/api/auth/[...nextauth]` - NextAuth endpoint
- `/login` page

**Protected routes (require auth)**:
- All other API routes use `requireUser()` pattern
- All pages except `/login` protected by middleware

**Middleware protection** (middleware.ts):
- Uses `export { auth as middleware }` from NextAuth
- Matcher excludes API routes, login, static assets
- `/login` page is publicly accessible

### 8. JSON Body Validation Patterns

**All routes use Zod schemas with `parseAndValidate`**:
```typescript
// Define schema in lib/validations/*.ts
import { z } from 'zod';
export const mySchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  quantity: z.number().positive().finite(),
});

// Use in route handler
const bodyState = await parseAndValidate(request, mySchema);
if (bodyState.error) return bodyState.error; // 400 with { error, details: { fieldErrors } }
const { name, quantity } = bodyState.data; // Fully validated + typed
```

### 9. Database Transaction Patterns

**For bulk operations**:
```typescript
const poolDb = getPoolDb();
if (!poolDb) return dbUnavailable();

await poolDb.transaction(async (tx) => {
  // Use tx for all operations
  await tx.insert(trades).values({ /* ... */ });
  await tx.insert(tradeExecutions).values({ /* ... */ });
});
```

### 10. Code Examples

**Complete GET endpoint**:
```typescript
export async function GET(request: NextRequest) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  
  try {
    const trades = await db.select()
      .from(trades)
      .where(eq(trades.userId, authState.user.id))
      .orderBy(desc(trades.date));
      
    return Response.json({ trades });
  } catch (error) {
    logRouteError('GET /api/trades', error);
    return internalServerError();
  }
}
```

**Complete POST endpoint**:
```typescript
export async function POST(request: NextRequest) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const bodyState = await parseAndValidate(request, createTradeSchema);
  if (bodyState.error) return bodyState.error;
  const body = bodyState.data; // Already validated by Zod

  try {
    const [trade] = await db.insert(trades)
      .values({
        id: crypto.randomUUID(),
        userId: authState.user.id,
        ticker: body.ticker.trim(),
        quantity: body.quantity,
        // ... other fields
      })
      .returning();

    return Response.json({ trade }, { status: 201 });
  } catch (error) {
    logRouteError('POST /api/trades', error);
    return internalServerError();
  }
}
```

## Do Not
- Do not bypass `requireUser()` in any protected route
- Do not omit `userId` filtering in database queries
- Do not use raw database clients without checking `dbUnavailable()`
- Do not skip `ensureUser()` after authentication
- Do not log sensitive data (tokens, user details) in `logRouteError()`
- Do not store tokens in localStorage or non-httpOnly cookies
- Do not create API routes without proper error handling
- Do not return plain strings - always return JSON with proper status codes
- Do not use NextAuth for session management (use manual JWT from lib/auth.ts)
- Do not create separate users tables for different auth methods
