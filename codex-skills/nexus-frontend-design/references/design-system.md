# Nexus Terminal Design System

This is a condensed copy of the repo's Claude frontend skill, kept as a reference for Codex-facing workflow.

## Identity

- Dark background with restrained emerald accents
- High information density, low visual noise
- Professional and utilitarian
- Traders scan fast; make important data obvious

## Core Rules

### Data-Ink Ratio

- Every visual element should either convey data or organize it.
- Use spacing before borders.
- Avoid bordered cards inside bordered sections unless the nested boundary is essential.
- Avoid background fills that do not separate meaningfully different groups.

### Visual Hierarchy

- Primary: price action, PnL, key metrics
- Secondary: ticker, side, date, tags
- Tertiary: metadata, timestamps, helper copy, low-priority controls

### Information Density

- Use `font-mono tabular-nums` on numeric data.
- Group related values with proximity instead of decorative boxes.
- Align numbers and labels consistently.

### Color Semantics

- Emerald: positive, active, primary
- Rose: negative, destructive, errors
- Amber: caution or neutral warning
- White: primary readable content
- Zinc 400/500: secondary and tertiary text

Do not add blue, purple, or unrelated accent colors.

## Common Tokens

- Page background: `bg-[#0A0A0B]`
- Card background: `bg-[#121214]`
- Standard border: `border-white/10`
- Subtle divider: `border-white/5`
- Overlay/input tint: `bg-white/5`
- Hover tint: `bg-white/10`

## Typography

- Page title: `text-2xl font-semibold tracking-tight`
- Section label: `text-xs font-medium uppercase tracking-[0.2em] text-zinc-400`
- Card title: `text-lg font-semibold` or `text-xl font-semibold`
- Body text: `text-sm text-zinc-400`
- Large number: `text-3xl font-semibold font-mono tabular-nums`
- Table number: `text-sm font-mono tabular-nums`

## Containers

- Standard card: `bg-[#121214] border border-white/10 rounded-2xl p-6`
- Compact card: `bg-[#121214] border border-white/10 rounded-xl p-4`
- Table wrapper: `overflow-x-auto rounded-xl border border-white/5 bg-[#121214]`
- Input: `rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm`

Only the outermost container of a section should usually carry a border.

## Motion

- Use `motion/react`
- Prefer small opacity and y-offset transitions
- Keep durations around 150ms to 300ms
- Respect `prefers-reduced-motion`
- Use hover lift sparingly

## Practical Checks

- No nested border stacks unless they add real meaning
- No washed-out or low-contrast data text
- No generic SaaS dashboard gradients or decorative clutter
- Empty, loading, and error states should match the same dark visual system

