Find and fix UI/UX inconsistencies across the app, focusing on: $ARGUMENTS

If no specific focus is given, audit the entire frontend for polish issues.

## What to Look For

### 1. Page Title & Header Inconsistencies
- Check every tab/page component in `components/trading/` for consistent title formatting
- Titles should follow the same pattern (capitalization, font size, font weight, spacing)
- Check that page descriptions/subtitles use consistent styling
- Verify breadcrumbs or section headers match across pages

### 2. Component Template Inconsistencies
- Find components that serve similar purposes across different pages (cards, lists, tables, stat blocks)
- Check they use the same spacing, border radius, background color, border style
- Standard card: `bg-[#121214] border border-white/5 rounded-2xl`
- Standard padding/spacing patterns should be consistent
- If two pages show stats in different card layouts, flag it

### 3. Color & Theme Consistency
- Primary accent: `emerald-500` (and its variants: `emerald-400`, `emerald-500/10`, `emerald-500/20`)
- Background: `#0A0A0B` (page), `#121214` (cards)
- Text: `text-white` (primary), `text-white/60` or `text-zinc-400` (secondary)
- Borders: `border-white/5` or `border-white/10`
- Flag any colors that don't match the theme (random blues, grays, or hardcoded hex values)

### 4. Typography Consistency
- Check heading hierarchy (h1, h2, h3) uses consistent sizes across pages
- Check font weights are consistent for similar elements
- Check that numbers/data use `tabular-nums` or monospace where appropriate (prices, PnL, percentages)

### 5. Spacing & Layout
- Check padding inside cards is consistent (usually `p-4` or `p-6`)
- Check gap between cards/sections is consistent
- Check margins between page sections follow a pattern
- Flag any raw pixel values or inconsistent Tailwind spacing

### 6. Interactive Elements
- Buttons: same style for same action type (primary = emerald, destructive = red, ghost = transparent)
- Hover states: consistent across similar elements
- Loading states: same spinner/skeleton pattern everywhere
- Empty states: consistent messaging style and layout

### 7. Icons
- All from Lucide React
- Consistent sizing for similar contexts (16px inline, 20px buttons, 24px headers)
- Same icon used for same concept across pages (don't use different icons for "delete" on different pages)

## Process

1. **Scan**: Read each component in `components/trading/` and `components/ui/`
2. **Catalog**: List every inconsistency found with file:line references
3. **Group**: Group findings by type (titles, cards, colors, spacing, etc.)
4. **Prioritize**: Mark each as Quick Fix (< 5 min) or Needs Discussion
5. **Fix**: Apply all Quick Fix items. Present Needs Discussion items for review.

## After Fixing
Run `npm run lint && npx tsc --noEmit` to verify.
Summarize what was changed and what still needs attention.
