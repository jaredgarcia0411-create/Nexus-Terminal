---
name: nexus-frontend-design
description: >
  Nexus Terminal UI system and review checklist. Use when editing frontend code in this repo:
  React components, Tailwind styles, layouts, cards, tabs, spacing, motion, accessibility,
  visual polish, or any request about how the interface should look and behave.
---

# Nexus Terminal Frontend Design

Use this skill whenever a task materially changes visible UI.

## Workflow

1. Preserve the existing visual language. Nexus Terminal is a dark, data-dense trading tool, not a marketing site.
2. For substantial UI work, read `references/design-system.md` before editing.
3. Keep page orchestration in `app/page.tsx`; push visual detail down into components.
4. Prefer minimal, focused changes that reinforce existing patterns over stylistic churn.

## Non-Negotiables

- Favor information density with clear structure over extra chrome.
- Use spacing, hierarchy, and typography before adding borders or extra backgrounds.
- Treat emerald as positive/active, rose as negative/destructive, amber as caution, white as primary content, and zinc as supporting text.
- Keep important numeric data in mono with tabular figures.
- Motion should communicate state change, stay subtle, and generally stay within 150ms to 300ms.
- Preserve keyboard/focus accessibility and readable empty, loading, and error states.
- Do not introduce off-brand bright colors, soft consumer-app cards, or airy landing-page patterns into trading surfaces.

## Review Checklist

- Does the change reduce or at least avoid adding visual noise?
- Are outer containers doing the separation work instead of nested bordered children?
- Are the most important numbers and actions visually dominant?
- Does the layout still scan well on laptop and mobile widths?
- If animation was added, does removing it make the UX worse? If not, cut it.

