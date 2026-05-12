---
name: nexus-vercel-ops
description: >
  Nexus Terminal Vercel workflow guide. Use when debugging deployments, preview URLs, build logs,
  runtime logs, cron configuration, or Vercel-specific Next.js behavior for this linked project.
---

# Nexus Vercel Ops

Use this skill for live Vercel work. Prefer the Vercel plugin skills and MCP tools over ad hoc shell commands when they cover the task.

## Read First

- `.vercel/project.json`
- `vercel.json`
- the route, page, or deployment URL involved

## Workflow

1. Resolve the linked project from `.vercel/project.json`.
   - This repo is linked to the `nexus-terminal` Vercel project.
   - Read `projectId` and `orgId` from the file at runtime instead of hardcoding them elsewhere.
2. Choose the right Vercel capability.
   - Use `vercel:vercel-api` or the Vercel MCP tools for deployment state, build logs, runtime logs, and project metadata.
   - Use `vercel:nextjs` when the issue is really App Router, caching, routing, or rendering behavior.
   - Use `vercel:verification` or `vercel:agent-browser-verify` for visual preview checks.
   - Use `vercel:investigation-mode` when the problem is vague, intermittent, or production-only.
3. Debug in the right order.
   - Deployment/build failure: list deployments, inspect the target deployment, then read build logs.
   - Runtime/server failure: inspect runtime logs for the project or deployment.
   - Protected preview URL: use the Vercel access helper before assuming the preview is broken.
   - Docs or platform uncertainty: search Vercel documentation before guessing.
4. Respect repo-specific config.
   - Read `vercel.json` at runtime before discussing cron configuration. Current known crons are `/api/cron/agent-retention` on `0 8 * * *` and `/api/cron/mdr-sweep` on `0 22 * * 1-5`.
   - After code changes, local validation still matters: `npm run lint`, `npx tsc --noEmit`, and `npm test`.

## Current Repo Reference Points

- `.vercel/project.json` contains the current `projectId`, `orgId`, and project name.
- `vercel.json` is the source of truth for cron configuration in this repo.
- The app is a Next.js 15 App Router project deployed on Vercel.

## Do Not

- Do not commit or edit `.vercel/project.json` unless the user explicitly asks to relink the repo.
- Do not assume preview deployments are publicly accessible.
- Do not use Vercel tooling for code-only tasks that can be resolved locally.
- Do not skip local validation after making code changes just because the deployment looks healthy.
