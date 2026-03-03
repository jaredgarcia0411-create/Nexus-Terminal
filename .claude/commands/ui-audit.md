Perform a UI/UX audit on the specified file or component: $ARGUMENTS

## Checklist

1. **Accessibility (a11y)**
   - All interactive elements have proper `aria-label` or `aria-labelledby`
   - Color contrast meets WCAG AA (4.5:1 text, 3:1 large text) against the `#0A0A0B` background
   - Focus states are visible (not just `outline-none` with no replacement)
   - Keyboard navigation works (tab order, Enter/Space activation, Escape to close)
   - Images and icons have alt text or `aria-hidden="true"` if decorative
   - Form inputs have associated labels

2. **Responsiveness**
   - No hardcoded widths that break on smaller screens
   - Text doesn't overflow containers
   - Touch targets are at least 44x44px on mobile
   - Sidebar collapses or adapts on small viewports

3. **Loading & Empty States**
   - Components handle `loading`, `empty`, and `error` states gracefully
   - Skeleton loaders or spinners shown during async operations
   - Empty states have helpful messaging and a call-to-action

4. **Animation & Motion**
   - `motion/react` transitions use `AnimatePresence` with proper `key` props
   - Animations don't block interaction (short durations, no layout thrashing)
   - `prefers-reduced-motion` is respected where possible

5. **Consistency with Design System**
   - Card backgrounds use `bg-[#121214] border border-white/5 rounded-2xl`
   - Primary accent is emerald (`text-emerald-500`, `bg-emerald-500/10`)
   - Uses shadcn/ui components (Button, Dialog, Sheet, etc.) instead of raw HTML
   - Toast notifications use Sonner (`toast()`, `toast.success()`, `toast.error()`)
   - Icons from Lucide React, consistent sizing

6. **User Feedback**
   - Destructive actions have confirmation dialogs
   - Success/error feedback via toast after mutations
   - Buttons show loading state during async operations (disabled + spinner)

Report each finding with the file path, line number, the issue, and a suggested fix. Prioritize findings as: Critical, Warning, or Suggestion.
