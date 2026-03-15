Design, build, or refine UI for: $ARGUMENTS

You have two modes. Pick the right one based on the request:

- **Design mode** — User wants to build something new (component, page, feature, layout)
- **Refine mode** — User wants to improve how something existing looks and feels

If the request is ambiguous, ask which mode they want.

---

## NEXUS DESIGN SYSTEM — Source of Truth

### Color Tokens
| Role | Value | Usage |
|------|-------|-------|
| Page background | `#0A0A0B` | `bg-[#0A0A0B]` — outermost background |
| Card background | `#121214` | `bg-[#121214]` — all cards, containers, panels |
| Primary accent | `emerald-500` | CTAs, active states, positive values, links |
| Accent hover | `emerald-400` | Hover state for emerald elements |
| Accent tint | `emerald-500/10` | Subtle accent backgrounds on cards |
| Accent glow | `emerald-500/20` | Active toggle backgrounds, hover tints |
| Negative | `rose-500` / `rose-400` | Losses, destructive actions, errors |
| Caution | `amber-500` / `amber-300` | Warnings, neutral macro sentiment |
| Primary text | `text-white` | Headings, important values |
| Secondary text | `text-zinc-400` | Descriptions, labels, metadata |
| Tertiary text | `text-zinc-500` | Placeholders, disabled text |
| Border standard | `border-white/10` | Default card/container borders |
| Border subtle | `border-white/5` | Table dividers, row separators |
| Surface overlay | `bg-white/5` | Input backgrounds, table headers |
| Surface hover | `bg-white/10` | Hover states on ghost/secondary elements |

### Typography Scale
| Element | Classes | Example |
|---------|---------|---------|
| Page title | `text-2xl font-semibold tracking-tight` | "Dashboard", "Performance" |
| Section label | `text-xs font-medium uppercase tracking-[0.2em] text-zinc-400` | "OVERVIEW", "RECENT TRADES" |
| Card title | `text-xl font-semibold` or `text-lg font-semibold` | Stat card headers |
| Body text | `text-sm text-zinc-400` | Descriptions, paragraphs |
| Small label | `text-xs text-zinc-500` | Timestamps, metadata |
| Large number | `text-3xl font-semibold font-mono tabular-nums` | PnL totals, key metrics |
| Table number | `text-sm font-mono tabular-nums` | Prices, dates, percentages |
| Button text | `text-sm font-semibold` | Primary actions |
| Tag/badge | `text-[10px] font-bold uppercase` | LONG, SHORT, status pills |

**Rules:**
- Use `font-mono tabular-nums` on ALL numeric data (prices, PnL, percentages, dates, counts)
- Use `tracking-[0.2em] uppercase` for section labels only
- Prefer `font-semibold` over `font-bold` for headings (bold is for badges/tags only)
- Never use arbitrary font sizes like `text-[11px]` — stick to the Tailwind scale

### Card & Container Patterns
```
Standard card:     bg-[#121214] border border-white/10 rounded-2xl p-6
Compact card:      bg-[#121214] border border-white/10 rounded-xl p-4
Table wrapper:     overflow-x-auto rounded-xl border border-white/5 bg-[#121214]
Input field:       rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm
Modal overlay:     bg-black/50 backdrop-blur-sm
```

### Animation & Motion Standards

**Library:** `motion/react` (imported as `motion` and `AnimatePresence`)

**Page/Tab entry:**
```tsx
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -10 }}
  transition={{ duration: 0.25, ease: "easeOut" }}
>
```

**Modals/Sheets:** Use shadcn Dialog/Sheet defaults (they handle enter/exit)

**Expand/collapse (lists, panels, accordions):**
```tsx
<motion.div
  initial={{ opacity: 0, height: 0 }}
  animate={{ opacity: 1, height: "auto" }}
  exit={{ opacity: 0, height: 0 }}
  transition={{ duration: 0.2, ease: "easeInOut" }}
>
```

**Staggered children (card grids, list items):**
```tsx
// Parent
<motion.div initial="hidden" animate="visible" variants={{
  visible: { transition: { staggerChildren: 0.05 } }
}}>
  {items.map(item => (
    <motion.div key={item.id} variants={{
      hidden: { opacity: 0, y: 8 },
      visible: { opacity: 1, y: 0 }
    }} />
  ))}
</motion.div>
```

**Hover micro-interactions (cards, clickable rows):**
```tsx
<motion.div whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
```

**Number count-up (stat values on load):**
```tsx
<motion.span
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.4 }}
>
```

**Rules:**
- Duration range: 150ms–300ms (never exceed 500ms except sheet open)
- Easing: `easeOut` for entrances, `easeInOut` for expand/collapse
- Always wrap animated route/tab content in `<AnimatePresence mode="wait">`
- Keep `y` offsets small: 8–10px for entrance, -2px for hover lift
- Respect `prefers-reduced-motion` — wrap motion in a check when adding new animations:
  ```tsx
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ```

### Hover & Transition Patterns
```
Color transition:  transition-colors duration-150
All properties:    transition-all duration-200
Opacity fade:      transition-opacity duration-200

Primary button:    bg-emerald-500 hover:bg-emerald-400 transition-colors
Ghost button:      bg-white/5 hover:bg-white/10 transition-colors
Icon button:       text-zinc-400 hover:text-white hover:bg-white/10 transition-colors
Table row:         hover:bg-white/5 cursor-pointer transition-colors
Link text:         text-emerald-500 hover:text-emerald-400 transition-colors
Destructive:       bg-rose-500 hover:bg-rose-400 transition-colors
```

### Focus States
```
Standard:  focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]
```
Apply to ALL interactive elements: inputs, buttons, selects, checkboxes.

### Spacing System
| Context | Pattern |
|---------|---------|
| Page sections | `space-y-8` |
| Card groups | `gap-6` in grid |
| Within cards | `space-y-4` or `space-y-3` |
| Compact lists | `space-y-1` or `gap-2` |
| Button padding | `px-4 py-2` (standard), `px-3 py-1.5` (small) |
| Card padding | `p-6` (standard), `p-4` (compact) |
| Grid layouts | `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3` |

### Component Library
- **UI primitives:** shadcn/ui (`components/ui/`) — Button, Dialog, Sheet, Popover, Tooltip, etc.
- **Icons:** Lucide React — `h-4 w-4` inline, `h-5 w-5` buttons, `h-6 w-6` headers
- **Toasts:** Sonner — `toast()`, `toast.success()`, `toast.error()`
- **Charts:** recharts (analytics), lightweight-charts (candlestick)

---

## DESIGN MODE — Building New UI

When the user asks you to build something new, follow this process:

### Step 1: Understand the requirement
- What is being built? (component, page section, full page, modal, etc.)
- What data does it display or collect?
- Where does it live in the app? (which tab, standalone, overlay)

### Step 2: Design the structure
Before writing code, describe:
- **Layout** — how elements are arranged (grid, flex column, sidebar+main, etc.)
- **Hierarchy** — what's the most important element? What's secondary?
- **States** — loading, empty, populated, error, hover, active
- **Interactions** — what's clickable? What happens on click?

### Step 3: Build with the design system
- Use ONLY the tokens, patterns, and components defined above
- Every card uses the standard card pattern
- Every number uses `font-mono tabular-nums`
- Every interactive element has hover + focus states
- Every async operation has a loading state
- Add entrance animations using the motion patterns above

### Step 4: Polish checklist
Before finishing, verify:
- [ ] Colors only from the token table (no random hex values)
- [ ] Typography follows the scale (no arbitrary sizes)
- [ ] All numbers are `font-mono tabular-nums`
- [ ] Cards use standard border/bg/radius
- [ ] Hover states on all interactive elements
- [ ] Focus rings on all focusable elements
- [ ] Loading state for any async data
- [ ] Empty state with helpful message
- [ ] Motion entrance animation on the container
- [ ] Icons from Lucide, sized consistently
- [ ] Spacing follows the 4px/8px system (Tailwind scale)

---

## REFINE MODE — Making Existing UI Look Better

When the user asks you to improve existing UI (or you're scanning for refinements), follow this process:

### Step 1: Read the target
Read every file in the target area. If no specific target, scan `components/trading/` page by page.

### Step 2: Evaluate against these professional polish criteria

**A. Motion & Feel — "Does it feel alive?"**
- Page/tab entrances should fade+slide in (not just pop)
- Modals/sheets should have backdrop blur (`backdrop-blur-sm`)
- Card grids should stagger-animate on load
- Interactive cards should have subtle hover lift (`whileHover={{ y: -2 }}`)
- Expanding/collapsing sections should animate height, not just toggle
- Number values that change should transition smoothly
- Loading states should use skeleton shimmer, not plain text "Loading..."

**B. Typography & Readability — "Does it look sharp?"**
- Numbers aligned in columns? Use `tabular-nums`
- Financial data in `font-mono`?
- Section labels using the uppercase+tracking pattern?
- Heading hierarchy consistent? (2xl > xl/lg > sm > xs)
- Line lengths readable? (max-w-prose or similar constraints on long text)
- Letter-spacing on headings? (`tracking-tight` on large text looks premium)

**C. Visual Depth — "Does it have dimension?"**
- Cards should have subtle border, not just float on the background
- Active/selected states should be clearly distinct (not just bold text)
- Use emerald tint backgrounds (`bg-emerald-500/5` or `/10`) to highlight key cards
- Important stats can use a subtle glow: `shadow-lg shadow-emerald-500/10`
- Sticky headers should have `backdrop-blur-md` + border-bottom

**D. Micro-interactions — "Does it respond to me?"**
- Buttons show loading spinner during async (not just disabled)
- Hover states on everything clickable
- Tooltips on icon-only buttons (what does this icon do?)
- Tag/badge hover reveals remove action
- Copy-to-clipboard with toast feedback
- Smooth color transitions (not instant color changes)

**E. Consistency — "Does it feel like one product?"**
- Same card style everywhere (bg, border, radius, padding)
- Same button styles for same action types
- Same icon sizes in same contexts
- Same spacing between similar elements
- Same loading pattern everywhere
- Same empty state pattern everywhere

**F. Professional Details — "The little things"**
- Dividers between table rows (`divide-y divide-white/5`)
- Rounded avatars/images (`rounded-full`)
- Truncate long text with ellipsis (`truncate` or `line-clamp-2`)
- Number formatting (commas, fixed decimals, +/- prefix)
- Relative timestamps ("2h ago" not "2024-01-15T14:30:00Z")
- Currency symbols and consistent decimal places

### Step 3: Report findings
For each finding, report:
```
**[Category] File:line — What's wrong**
Current: `what it looks like now`
Better:  `what it should look like`
Why: one sentence explaining the visual improvement
```

Group findings by impact:
1. **High impact** — visible on every page load, affects overall feel
2. **Medium impact** — noticeable on specific pages, improves polish
3. **Low impact** — subtle details that add up to "premium" feel

### Step 4: Fix
Apply all fixes. Run `npm run lint && npx tsc --noEmit` after.

---

## WHAT THIS SKILL IS NOT

- **Not an accessibility audit** — use `/ui-audit` for a11y compliance
- **Not a consistency scanner** — use `/ui-polish` for design system violations
- This skill is about making the UI **look and feel professional** — smooth, polished, intentional. It's the difference between "works correctly" and "feels like a real product."
