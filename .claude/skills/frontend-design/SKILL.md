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
| Primary accent | `emerald-500` | CTAs, active states, positive values |
| Accent hover | `emerald-400` | Hover state for emerald elements |
| Accent tint | `emerald-500/10` | Subtle accent backgrounds |
| Accent glow | `emerald-500/20` | Active toggles, hover tints |
| Negative | `rose-500` / `rose-400` | Losses, destructive actions, errors |
| Caution | `amber-500` / `amber-300` | Warnings, neutral sentiment |
| Primary text | `text-white` | Headings, important values, readable data |
| Secondary text | `text-zinc-400` | Descriptions, labels, metadata |
| Tertiary text | `text-zinc-500` | Placeholders, disabled text |
| Border standard | `border-white/10` | Default card/container borders |
| Border subtle | `border-white/5` | Table dividers, row separators |
| Surface overlay | `bg-white/5` | Input backgrounds, table headers |
| Surface hover | `bg-white/10` | Hover states on ghost elements |

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
| Tag/badge | `text-[10px] font-bold uppercase` |

**Typography rules:**
- `font-mono tabular-nums` on ALL numeric data (prices, PnL, percentages, dates, counts)
- `tracking-[0.2em] uppercase` for section labels only
- `font-semibold` over `font-bold` for headings (bold is for badges/tags only)
- Stick to the Tailwind type scale — no arbitrary sizes like `text-[11px]`

### Cards & Containers
```
Standard card:     bg-[#121214] border border-white/10 rounded-2xl p-6
Compact card:      bg-[#121214] border border-white/10 rounded-xl p-4
Table wrapper:     overflow-x-auto rounded-xl border border-white/5 bg-[#121214]
Input field:       rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm
Modal overlay:     bg-black/50 backdrop-blur-sm
```

**Border reduction rule:** Only the outermost container of a section gets a border. Children inside a card use spacing, dividers (`divide-y divide-white/5`), or background tints — never their own borders. If you see a border inside a border, remove the inner one.

### Hover & Transitions
```
Color transition:  transition-colors duration-150
All properties:    transition-all duration-200

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
| Mixed card border-radius | Feels inconsistent and unfinished | `rounded-2xl` standard, `rounded-xl` compact |
| Arbitrary font sizes | Breaks the type hierarchy | Use the Tailwind type scale only |
| Heavy borders on inner sections | Creates visual clutter inside cards | Use spacing or `divide-y` inside cards |
| Animating everything | Slows the interface, distracts | Only animate meaningful state transitions |
| `font-bold` on headings | Too heavy, looks aggressive | Use `font-semibold`; bold is for badges only |
| Colors outside the palette | Introduces visual inconsistency | Emerald, rose, amber, white, zinc — that's it |
