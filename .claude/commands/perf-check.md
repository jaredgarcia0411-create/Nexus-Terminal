Analyze the performance of the specified file or component: $ARGUMENTS

## Performance Audit

### 1. Rendering Performance
- Identify components that re-render unnecessarily (missing `React.memo`, inline object/function props)
- Check for expensive computations not wrapped in `useMemo`
- Look for large lists rendered without virtualization (trade tables with 1000+ rows)
- Verify `AnimatePresence` isn't animating hidden tabs unnecessarily
- Check if `key` props cause unnecessary unmount/remount cycles

### 2. Bundle Size
- Flag large imports that could be code-split (`import dynamic from 'next/dynamic'`)
- Check for barrel imports pulling in unused code
- Identify components that should be lazy-loaded (tab content, dialogs, sheets)
- Look for duplicate functionality across components

### 3. Data Fetching
- API calls should not fire on every render (check `useEffect` dependencies)
- Check for waterfall requests that could be parallelized
- Verify `fetch` calls use appropriate caching strategies
- Database queries in API routes: check for N+1 queries or missing indexes

### 4. Memory
- Event listeners added in `useEffect` must be cleaned up in the return function
- Large datasets (trades array) shouldn't be duplicated across state
- File uploads (`contextFiles` in backtesting) — are files held in memory unnecessarily?
- Check for closures capturing large scopes

### 5. Specific to This Codebase
- `useTrades` hook returns many values — are consuming components subscribing to more state than they need?
- `filteredTrades` recomputes on every filter change — is the filtering logic efficient for large datasets?
- Recharts components can be slow with many data points — check for data aggregation
- CSV parsing with PapaParse — is it blocking the main thread for large files?

For each finding, provide the location, impact estimate (high/medium/low), and the recommended optimization.
