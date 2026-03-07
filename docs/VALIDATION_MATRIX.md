# Validation Matrix

## Default Repository Validation

Run these from repository root:

```bash
npm run lint
npx tsc --noEmit
npm test
```

## Database/Schema Validation

```bash
npm run db:generate
# optionally, against a configured DB environment
npm run db:migrate
```

## Service Package Validation

These run from repository root:

```bash
npm run build --prefix services/backtest-gateway
python3 -m py_compile services/backtest-worker/main.py
```

## Environment-Limited Checks

In this workspace, service package builds may fail until service-specific dependencies are installed in each service package context.

When service dependencies are unavailable locally:

1. Treat root validation (`lint`, `tsc`, `test`) as baseline gate.
2. Record service build status explicitly in handoff notes.
3. Re-run service builds in CI or in a provisioned service environment before release.

## Artifact Policy

Generated artifacts are not source-of-truth and should not be committed:

- `services/*/dist/`
- `services/**/__pycache__/`
- `tsconfig.tsbuildinfo`

Tracked source files and migrations remain the canonical review surface.
