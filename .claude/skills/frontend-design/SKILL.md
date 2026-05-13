---
name: frontend-design
description: |
  Nexus Terminal's unified UI/UX design system and principles. Use this skill whenever building, modifying, refining, auditing, or reviewing ANY frontend code in Nexus Terminal. This includes: creating new components or pages, redesigning existing UI, fixing visual issues, auditing accessibility, scanning for inconsistencies, polishing the interface, or any task involving Tailwind classes, React components, layouts, or visual appearance. Trigger on: UI, design, layout, styling, "looks wrong", "clean up", polish, audit, accessibility, component, page, tab, card, border, spacing, color, animation, responsive, mobile, dark theme, visual, frontend, CSS.
---

# Nexus Terminal — Frontend Design

Complete guide for every UI decision in Nexus Terminal. Covers design principles, the design system, and quality checklists. This replaces the need for separate UI audit, polish, or design commands — it's all here.

## Design Philosophy

Nexus Terminal is a **data-dense trading tool** for a small private team. The aesthetic is **dark, minimal, and functional** — like a modern Bloomberg Terminal. Every visual choice serves the data, not competes with it.

**Core identity:**
- Dark background (`#0A0A0B`) with emerald accent
- High information density, low visual noise
- Professional, utilitarian — not flashy, not playful
- Traders scan fast — make the important things obvious

---

## Core UX Principles

These guide every UI decision. When the design system doesn't cover a specific case, reason from these principles.

### 1. Data-Ink Ratio

Every pixel should either convey information or help organize it. Remove anything that doesn't. Borders, backgrounds, shadows, and decorative elements are "chrome" — minimize them.

**The border test:** Before adding a border, ask: "Would spacing alone create enough separation here?" If yes, skip the border. Nested borders (a bordered card inside a bordered section) almost always mean too much chrome. Only the outermost container of a section gets a border — children use spacing or subtle dividers.

**The background test:** Before adding a background, ask: "Does this background help the user distinguish content groups, or is it just filling space?" If it's just filling space, remove it.

### 2. Visual Hierarchy

Control what the eye sees first, second, third. In a trading context:
- **First:** Price action, PnL numbers, key metrics — large, white, prominent
- **Second:** Context like ticker, side, date, tags — medium, slightly muted
- **Third:** Metadata and controls like timestamps, settings, secondary actions — small, zinc-400/500

Use size, weight, color, and position to create hierarchy — not borders or boxes. Adding a border around something doesn't make it more important; it adds noise.

### 3. Information Density Without Clutter

Trading UIs need lots of data on screen. The solution isn't more whitespace — it's **clear structure** so density feels organized.

How to achieve this:
- Align numbers in columns (`tabular-nums` makes them stack cleanly)
- Use consistent label-then-value patterns
- Group related items with proximity (put them close together), not borders
- Use subtle background tints sparingly to highlight key groups

### 4. Reduce Visual Noise

Every visual element costs the user attention. Audit aggressively for:
- **Redundant borders** — nested containers each with their own border
- **Unnecessary backgrounds** — cards inside cards with slightly different grays
- **Overuse of dividers** — sometimes spacing alone separates just fine
- **Too many font sizes** — stick to the type scale
- **Inconsistent patterns** — when similar things look different, the brain works harder to parse them

### 5. Color Encodes Meaning

Color is not decoration — it communicates:
- **Emerald** = positive, active, primary action, profit
- **Rose/Red** = negative, loss, destructive, error
- **Amber** = warning, caution, neutral
- **White** = primary content, important readable data
- **Zinc-400** = secondary content, labels, descriptions
- **Zinc-500** = tertiary, disabled, placeholder

Never introduce colors outside this system. If something needs emphasis, use what exists — don't add blue, purple, or other off-brand colors.

**Text color rule:** If the user needs to actually read and act on data, it should be `text-white`. Reserve `text-zinc-400` for labels and metadata that provide context but aren't the main content. When in doubt, make it white — readability beats subtlety.

### 6. Progressive Disclosure

Show summaries first, details on demand. A card shows key metrics; clicking expands full details. A table shows essential columns; a sheet or modal reveals the full record. Don't front-load every piece of data at once.

### 7. Consistency Is Trust

When the same pattern appears in multiple places, it must look identical. Inconsistency makes the product feel unfinished and erodes user confidence. Same card style, same button style, same icon size, same spacing — everywhere, every time.

### 8. Motion Communicates State

Animation tells users something happened — a tab changed, content loaded, something expanded. It should never be purely decorative or slow things down. Keep durations 150–300ms. If removing an animation and nothing feels lost, it wasn't needed.

---

## Design System Tokens

### Colors
| Role | Value | Usage |
|------|-------|-------|
| Page background | `#0A0A0B` | `bg-[#0A0A0B]` — outermost background |
| Card background | `#121214` | `bg-[#121214]` — cards, containers, panels |
| Primary button | `bg-emerald-500/10 text-white` | Primary CTAs ("New Trade", "Save Review", "Apply Risk", "Launch Chart", "New Backtest", "Add Tag", "Set Auto Risk") — translucent emerald tint, white text |
| Primary button hover | `bg-emerald-500/20` | Hover state for primary buttons |
| Positive value | `emerald-500` | Profit text, positive PnL, calendar green days, "up" candle |
| Long direction | `emerald-500` | Long side indicator ("L") |
| Active toggle | `bg-zinc-700/60 text-zinc-100` | Selected state for range / mode toggles (All/30D/60D, Net/Gross, $/R, Research filing tabs) — NOT emerald |
| Accent tint | `emerald-500/10` | Sidebar active tab, primary button bg, subtle accent backgrounds (selected rows, ring) |
| Negative | `rose-500` / `rose-400` | Losses, destructive actions, errors, "down" candle, Short ("S") direction |
| Caution | `amber-500` / `amber-300` | Warnings, neutral sentiment |
| Primary text | `text-white` | Headings, important values, readable data, table column headers |
| Secondary text | `text-zinc-400` | Descriptions, labels, metadata |
| Tertiary text | `text-zinc-500` | Placeholders, disabled text |
| Border standard | `border-white/10` | Default card/container borders |
| Border subtle | `border-white/5` | Table dividers, row separators |
| Surface overlay | `bg-white/5` | Input backgrounds, table headers |
| Surface hover | `bg-white/10` | Hover states on ghost elements |

**Primary button pattern:** Primary CTAs (Save Review, Launch Chart, New Trade, Apply Risk, Add Tag, etc.) use `bg-emerald-500/10 text-white hover:bg-emerald-500/20` — the same translucent emerald the sidebar uses for the active tab, just with white text instead of `text-emerald-500`. NEVER use a solid emerald fill (`bg-emerald-500` / `-600` / `-700`) on these buttons — solid fills compete with positive-PnL text and read too "loud" against the dark background. The translucent style keeps CTAs visible without dominating the data.

**Active toggle pattern:** Range selectors, metric toggles, and tab-style filters use a neutral active state (`bg-zinc-700/60 text-zinc-100`) — not emerald. Emerald is for primary CTAs and data-meaning. A "selected" filter is a state indicator, not an action.

**Toggle button labels:** Mode/metric toggles use the shortest possible label — single tokens like "Net" / "Gross" or "$" / "R", not "Net PnL" / "Gross PnL" / "$ Metrics" / "R Metrics". The button group itself supplies the context.

### Typography
| Element | Classes |
|---------|---------|
| Page title | `text-2xl font-semibold tracking-tight` |
| Section label | `text-xs font-medium uppercase tracking-[0.2em] text-zinc-400` |
| Card title | `text-xl font-semibold` or `text-lg font-semibold` |
| Body text | `text-sm text-zinc-400` |
| Small label | `text-xs text-zinc-500` |
| Large number | `text-3xl font-semibold font-mono tabular-nums` |
| Table number | `text-sm font-mono tabular-nums` |
| Button text | `text-sm font-semibold` |
| Tag/badge | `text-xs font-bold capitalize` (NOT `uppercase`; reserve `text-[10px]` only for chip-style filter tags) |
| Side indicator (L/S) | `text-sm font-bold` colored (`text-emerald-500` long, `text-rose-500` short) — bare letter, no badge background |
| Table column header | `text-xs tracking-wider text-white` — title case (no `uppercase`); white, not zinc, so headers read as scannable labels |
| Calendar day header | `text-[10px] font-bold tracking-widest text-zinc-500` — title case (no `uppercase`) |

**Typography rules:**
- `font-mono tabular-nums` on ALL numeric data (prices, PnL, percentages, dates, counts)
- `tracking-[0.2em] uppercase` for section labels only — **not** for table column headers, calendar headers, or category badges
- `font-semibold` over `font-bold` for headings (bold is for badges/tags only)
- Stick to the Tailwind type scale — no arbitrary sizes like `text-[11px]`
- **`capitalize` over `uppercase`** for tabular headers and inline category labels: column titles, calendar day-of-week, type badges (daily/weekly), and titles like "Trading Calendar" all use title case. Reserve `uppercase` for the small `text-xs tracking-[0.2em]` section eyebrows that label whole regions of a page.

### Cards & Containers
```
Standard card:     bg-[#121214] border border-white/10 rounded-2xl p-6
Compact card:      bg-[#121214] border border-white/10 rounded-xl p-4
Table wrapper:     overflow-x-auto rounded border border-white/5 bg-[#121214]
Tag/type badge:    rounded-sm px-2 py-0.5 (less rounded than container; 2–4px corners on inline pills)
Input field:       rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm
Modal overlay:     bg-black/50 backdrop-blur-sm
```

**Border-radius hierarchy:** Larger surfaces get larger radii; inline chips/badges stay tight. Trading tables get the tightest corners of any container — they read as data grids, not cards.
- `rounded-2xl` (16px) — standard card
- `rounded-xl` (12px) — compact card, sheet/dialog
- `rounded-lg` (8px) — input, button, dropdown
- `rounded` (4px) — **table wrapper** (Trades, Archive review list) — tight corners so the table reads as data, not a balloon
- `rounded-sm` (2px) — inline type/category badges (daily/weekly tags, archive type column)
- No radius — direction letters (L/S) and other bare text indicators

**Border reduction rule:** Only the outermost container of a section gets a border. Children inside a card use spacing, dividers (`divide-y divide-white/5`), or background tints — never their own borders. If you see a border inside a border, remove the inner one.

### Hover & Transitions
```
Color transition:  transition-colors duration-150
All properties:    transition-all duration-200

Primary button:    bg-emerald-500/10 text-white hover:bg-emerald-500/20 transition-colors
Ghost button:      bg-white/5 hover:bg-white/10 transition-colors
Icon button:       text-zinc-400 hover:text-white hover:bg-white/10 transition-colors
Delete icon btn:   h-7 w-7 rounded-md border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300
Panel toggle btn:  h-6 w-6 rounded-md text-zinc-500 hover:bg-white/5 hover:text-white (with ChevronRight h-4 w-4)
Table row:         hover:bg-white/5 cursor-pointer transition-colors
Link text:         text-emerald-500 hover:text-emerald-400 transition-colors
Destructive btn:   bg-rose-500 hover:bg-rose-400 transition-colors
Active toggle:     bg-zinc-700/60 text-zinc-100 (selected); zinc-500 hover:text-white (unselected)
```

### Focus States
```
Standard:  focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-1 focus:ring-offset-[#121214]
```
Apply to ALL interactive elements: inputs, buttons, selects, checkboxes.

### Spacing
| Context | Pattern |
|---------|---------|
| Page sections | `space-y-8` |
| Card groups | `gap-6` in grid |
| Within cards | `space-y-4` or `space-y-3` |
| Compact lists | `space-y-1` or `gap-2` |
| Button padding | `px-4 py-2` (standard), `px-3 py-1.5` (small) |
| Card padding | `p-6` (standard), `p-4` (compact) |
| Grid layouts | `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3` |

### Animation

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

**Expand/collapse:**
```tsx
<motion.div
  initial={{ opacity: 0, height: 0 }}
  animate={{ opacity: 1, height: "auto" }}
  exit={{ opacity: 0, height: 0 }}
  transition={{ duration: 0.2, ease: "easeInOut" }}
>
```

**Staggered children:**
```tsx
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

**Hover lift:**
```tsx
<motion.div whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
```

**Animation rules:**
- Duration: 150ms–300ms (never exceed 500ms)
- Easing: `easeOut` for entrances, `easeInOut` for expand/collapse
- Wrap animated tab content in `<AnimatePresence mode="wait">`
- Small `y` offsets: 8–10px entrance, -2px hover lift
- Respect `prefers-reduced-motion`

### Component Library
- **UI primitives:** shadcn/ui (`components/ui/`) — Button, Dialog, Sheet, Popover, Select, Dropdown Menu, Command, Input, Label, Textarea. There is no Tooltip primitive yet — if you need one, add it via `npx shadcn@latest add tooltip` first rather than hand-rolling it.
- **Icons:** Lucide React — `h-4 w-4` inline, `h-5 w-5` buttons, `h-6 w-6` headers
- **Toasts:** Sonner — `toast()`, `toast.success()`, `toast.error()`
- **Charts:** recharts (analytics), lightweight-charts (candlestick)

### Chart Colors (Candlestick / Volume / Markers / Indicators)
Both backtest and research candle charts use the same palette. Any new chart that renders OHLC/volume should reuse these exact hex values — do not introduce new candle colors.

| Element | Color | Notes |
|---------|-------|-------|
| Up candle (body + border + wick) | `#22c55e` (green-500) | Bullish bar |
| Down candle (body + border + wick) | `#ef4444` (red-500) | Bearish bar |
| Up volume bar | `#22c55e33` / `rgba(34,197,94,0.55)` | 20% alpha overlay for compact charts; 55% for paned histogram |
| Down volume bar | `#ef444433` / `rgba(239,68,68,0.55)` | Same alpha rules as up volume |
| Long execution arrow | `#86efac` (green-300) | Lighter green so it pops against green candle bodies |
| Short execution arrow | `#fca5a5` (red-300) | Lighter red so it pops against red candle bodies |
| VWAP line | `#15803d` (green-700) | Deeper forest green so it contrasts the green candle bodies |
| Grid lines | `#ffffff08` | Very faint white |
| Chart background | `#0A0A0B` (research) / `#121214` (backtest) | Matches surrounding panel |

**Marker rule:** Execution arrows must contrast against the candle they sit on. Because candles are green/red, markers use the 300-shade (lighter) variants. Never reuse 500-shade green/red for execution markers — they'll disappear into the candle.

**Indicator rule:** Any line indicator that's green (VWAP, EMA9, etc.) must sit at a different shade than the candle body. VWAP uses green-700; EMA9 uses green-500. If you add a new green indicator, pick a shade not already in use.

### Collapse / Expand Pattern (Side Panels)
The Backtesting right panel is the reference implementation for any collapsible side panel.

- **State** lives in the parent (e.g. `rightCollapsed`); the child renders nothing when the parent decides it's hidden, no internal "collapsed mode" branch.
- **No fade / no opacity animation.** Mount/unmount only. Fading the panel out while the grid column animates produced jumpy paint when reopened — keep it instant.
- **Grid does the size transition** via `transition-[grid-template-columns] duration-300`. The right column goes between its size (e.g. `220px` / `280px`) and a single `minmax(0,1fr)` (no right column) when collapsed.
- **Toggle button** is the same markup in both states — same icon, same size — so it never looks like two different controls:
  ```
  <button class="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-white">
    <ChevronRight class="h-4 w-4" />
  </button>
  ```
  Position differs: expanded → top-right of the panel itself; collapsed → top-right of the main content area (above any toolbar border).

---

## Workflow

For any UI task:

**1. Read first.** Read the target component(s) completely before changing anything. Understand the structure, data flow, and state management.

**2. Identify the work type:**
- **Build** — creating something new (component, page, feature)
- **Refine** — improving how something existing looks/works
- **Audit** — systematically finding issues (may or may not fix)

**3. Apply the principles.** For every decision, ask:
- Does this serve the data or compete with it? (Data-Ink Ratio)
- Is the visual hierarchy clear? (Visual Hierarchy)
- Am I adding noise or reducing it? (Reduce Visual Noise)
- Is this consistent with the rest of the app? (Consistency)
- Can the user read the important content easily? (Text Color Rule)

**4. Use the design system.** Every color, font size, spacing value, and pattern should come from the tokens above. No custom hex values, no arbitrary Tailwind values, no one-off patterns.

**5. Run the checklist** before considering work complete.

**6. Verify.** `npm run lint && npx tsc --noEmit` after all changes.

---

## Quality Checklist

### Visual Polish
- [ ] Colors only from the token table (no random hex values)
- [ ] Typography follows the scale (no arbitrary sizes)
- [ ] All numbers use `font-mono tabular-nums`
- [ ] Cards use standard bg/border/radius patterns
- [ ] No nested borders — outermost container only
- [ ] Readable data is `text-white`, not unnecessarily gray
- [ ] Hover states on all interactive elements
- [ ] Focus rings on all focusable elements
- [ ] Icons from Lucide, sized consistently per context
- [ ] Spacing follows Tailwind scale

### States
- [ ] Loading state (skeleton or spinner) for async data
- [ ] Empty state with helpful message
- [ ] Error state with user feedback
- [ ] Buttons show loading during async operations

### Motion
- [ ] Container has entrance animation
- [ ] Grids/lists use staggered children
- [ ] Expand/collapse sections animate height
- [ ] `AnimatePresence` wraps animated content
- [ ] All durations 150–300ms

### Accessibility
- [ ] Icon-only buttons have `aria-label`
- [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 large text)
- [ ] Focus states visible (not just `outline-none` with no ring)
- [ ] Keyboard navigation works (tab order, Enter/Space, Escape to close)
- [ ] Form inputs have associated labels

### Consistency
- [ ] Same card style across all pages
- [ ] Same button style for same action type
- [ ] Same icon for same concept across pages
- [ ] Same spacing between similar elements
- [ ] Same loading and empty state patterns everywhere

### Data Presentation
- [ ] Numbers formatted with commas, fixed decimals, +/- prefix
- [ ] Currency has `$` symbol and consistent decimal places
- [ ] Long text truncated (`truncate` or `line-clamp-2`)
- [ ] Relative timestamps where helpful ("2h ago")
- [ ] Tables use `divide-y divide-white/5` between rows

---

## Anti-Patterns — Things to Never Do

| Anti-Pattern | Why It's Bad | What to Do Instead |
|---|---|---|
| Nested borders | Adds visual weight without information | Only outermost container gets a border |
| Gray text on readable data | Users strain to read important content | Use `text-white` for data users act on |
| Random hex colors | Breaks the visual language | Only use colors from the token table |
| Decorative gradients/glows | Competes with the data | Remove unless it encodes meaning |
| Mixed card border-radius | Feels inconsistent and unfinished | Follow the radius hierarchy: `rounded-2xl` standard card, `rounded-xl` compact card, `rounded` table wrapper, `rounded-sm` tag/badge |
| Emerald badge for a "selected" filter | Looks like a CTA, not a state | Use `bg-zinc-700/60 text-zinc-100` for active filter/range/mode toggles |
| Solid emerald fill on a primary button | Competes with positive-PnL text; reads too loud on the dark UI | Use `bg-emerald-500/10 text-white hover:bg-emerald-500/20` — translucent tint, same as sidebar active tab |
| `uppercase` on tabular headers / category tags | Adds visual weight without information | Title case via `capitalize` (or natural casing) — reserve `uppercase` for `tracking-[0.2em]` section eyebrows |
| 500-shade arrow on a 500-shade candle | Marker disappears into the candle body | Use 300-shade marker (`#86efac` / `#fca5a5`) — lighter than the candle |
| 500-shade green indicator line on green candles | Indicator melts into candle bodies | Use a different shade than the candle (VWAP = green-700, EMA9 = green-500, etc.) |
| Opacity fade on grid-collapsing panels | Looks jumpy when the column resizes underneath the fade | Mount/unmount only; let `transition-[grid-template-columns]` handle the motion |
| Arbitrary font sizes | Breaks the type hierarchy | Use the Tailwind type scale only |
| Heavy borders on inner sections | Creates visual clutter inside cards | Use spacing or `divide-y` inside cards |
| Animating everything | Slows the interface, distracts | Only animate meaningful state transitions |
| `font-bold` on headings | Too heavy, looks aggressive | Use `font-semibold`; bold is for badges only |
| Colors outside the palette | Introduces visual inconsistency | Emerald, rose, amber, white, zinc — that's it |
