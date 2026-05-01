import type { ReviewWithStats } from '@/lib/backtest-stats';

export type FilterDef = {
  id: string;
  label: string;
  group: string;
  predicate: (review: ReviewWithStats) => boolean;
};

export const FILTER_REGISTRY: FilterDef[] = [
  { id: 'winners', label: 'Winners', group: 'outcome', predicate: (review) => review.stats.realizedPnl > 0 },
  { id: 'losers', label: 'Losers', group: 'outcome', predicate: (review) => review.stats.realizedPnl < 0 },
  { id: 'long', label: 'Long', group: 'direction', predicate: (review) => review.stats.direction === 'LONG' },
  { id: 'short', label: 'Short', group: 'direction', predicate: (review) => review.stats.direction === 'SHORT' },
  { id: 'gap-up', label: 'Gap Up', group: 'gap', predicate: (review) => (review.stats.gapPct ?? 0) > 0 },
  { id: 'gap-down', label: 'Gap Down', group: 'gap', predicate: (review) => (review.stats.gapPct ?? 0) < 0 },
];

export function applyFilters(
  reviews: ReviewWithStats[],
  activeFilterIds: Set<string>,
  dynamicFilters: FilterDef[],
): ReviewWithStats[] {
  if (activeFilterIds.size === 0) return reviews;

  const filtersById = new Map([...FILTER_REGISTRY, ...dynamicFilters].map((filterDef) => [filterDef.id, filterDef]));

  return reviews.filter((review) =>
    [...activeFilterIds].every((id) => {
      const filterDef = filtersById.get(id);
      return filterDef ? filterDef.predicate(review) : true;
    }),
  );
}

export function buildGradeFilters(reviews: ReviewWithStats[]): FilterDef[] {
  const grades = [...new Set(reviews.map((review) => review.stats.grade).filter((grade): grade is string => grade !== null))].sort();

  return grades.map((grade) => ({
    id: `grade-${grade}`,
    label: `Grade ${grade}`,
    group: 'grade',
    predicate: (review) => review.stats.grade === grade,
  }));
}

export function buildSetupFilters(reviews: ReviewWithStats[]): FilterDef[] {
  const setups = [...new Set(reviews.map((review) => review.stats.setupType).filter((setup): setup is string => setup !== null))].sort();

  return setups.map((setup) => ({
    id: `setup-${setup}`,
    label: setup,
    group: 'setup',
    predicate: (review) => review.stats.setupType === setup,
  }));
}
