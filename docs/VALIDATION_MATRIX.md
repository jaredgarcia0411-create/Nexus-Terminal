# Validation Matrix

## Default Repository Validation

Run these from repository root, in order:

```bash
npm run lint
npx tsc --noEmit
# If touched files include services/
npm run typecheck:services
npm test
```

## Database/Schema Validation

```bash
npm run db:generate
# apply generated migrations against a configured DB environment
npm run db:migrate
```

Use `npm run db:migrate` for migration application in normal cleanup and release work. `npm run db:push` is for development-only schema pushes and is not the default validation path.

## Service Validation

The root `tsconfig.json` excludes `services/`. When a change touches `services/`, run:

```bash
npm run typecheck:services
```

## Environment-Limited Checks

In this workspace, environment-backed checks may fail when credentials, external services, or local service dependencies are unavailable.

When an environment-limited check cannot run locally:

1. Treat root validation (`lint`, `tsc`, `test`) as baseline gate.
2. Record the skipped or blocked check explicitly in handoff notes.
3. Re-run it in CI or in a provisioned environment before release.

## Artifact Policy

Generated artifacts are not source-of-truth and should not be committed:

- `services/*/dist/`
- `services/**/__pycache__/`
- `tsconfig.tsbuildinfo`

Tracked source files and migrations remain the canonical review surface.
