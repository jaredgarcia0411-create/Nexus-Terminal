'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { formatDate, formatMoney, getField, toNumberValue, toRecord, toStringValue } from '@/lib/askedgar-utils';

import { NoDataBadge, pillClasses, ratingLevel } from './_shared';

interface HistoricalDilutionRatingPayload {
  ticker: string;
  date: string;
  rating: {
    status: string;
    results: unknown[];
    error?: string;
  };
}

interface Props {
  ticker: string;
  date: string;
}

function getStringField(row: Record<string, unknown>, keys: string[]) {
  const value = getField(row, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatMonthValue(value: unknown) {
  const numeric = toNumberValue(value);
  return numeric === null ? '--' : numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatBoolean(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) return 'Yes';
    if (['false', 'no', 'n', '0'].includes(normalized)) return 'No';
  }
  return '--';
}

function formatPrimitive(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return toStringValue(value);
  }
  return '--';
}

function RatingValue({ value }: { value: string | null }) {
  const level = ratingLevel(value);
  return (
    <span className={`inline-flex min-w-14 justify-center rounded-sm px-2 py-0.5 text-xs font-semibold ${pillClasses(level)}`}>
      {toStringValue(value)}
    </span>
  );
}

function MetricCell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="h-8 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}

export default function HistoricalDilutionRatingCard({ ticker, date }: Props) {
  const requestKey = `${ticker}:${date}`;
  const [state, setState] = useState<{
    requestKey: string;
    payload: HistoricalDilutionRatingPayload | null;
    error: string | null;
  }>({
    requestKey: '',
    payload: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch(
      `/api/historical-dilution-rating?ticker=${encodeURIComponent(ticker)}&date=${encodeURIComponent(date)}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((nextPayload: HistoricalDilutionRatingPayload) => {
        setState({ requestKey, payload: nextPayload, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({
          requestKey,
          payload: null,
          error: err instanceof Error ? err.message : 'Unable to load rating',
        });
      });

    return () => controller.abort();
  }, [date, requestKey, ticker]);

  const loading = state.requestKey !== requestKey;
  const row = toRecord(state.payload?.rating.results[0]);

  return (
    <div className="min-h-[280px] rounded-lg border border-border bg-card p-3 text-sm">
      <div className="mb-3 border-b border-border pb-2">
        <h4 className="font-semibold text-foreground">Dilution Rating</h4>
        <p className="text-xs text-muted-foreground">as of {formatDate(date)}</p>
      </div>

      {loading ? <LoadingRows /> : null}
      {!loading && state.error ? <NoDataBadge /> : null}
      {!loading && !state.error && state.payload ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <MetricCell label="Overall Risk">
            <RatingValue value={getStringField(row, ['overall_offering_risk', 'overallOfferingRisk'])} />
          </MetricCell>
          <MetricCell label="Cash Need">
            <RatingValue value={getStringField(row, ['cash_need', 'cashNeed'])} />
          </MetricCell>
          <MetricCell label="Offering Ability">
            <RatingValue value={getStringField(row, ['offering_ability', 'offeringAbility'])} />
          </MetricCell>
          <MetricCell label="Offering Frequency">
            <RatingValue value={getStringField(row, ['offering_frequency', 'offeringFrequency'])} />
          </MetricCell>
          <MetricCell label="Dilution">
            <RatingValue value={getStringField(row, ['dilution'])} />
          </MetricCell>
          <MetricCell label="Estimated Cash">
            <span className="font-mono tabular-nums">{formatMoney(getField(row, ['estimated_cash', 'estimatedCash']))}</span>
          </MetricCell>
          <MetricCell label="Cash Remaining">
            <span className="font-mono tabular-nums">{formatMonthValue(getField(row, ['cash_remaining_months', 'cashRemainingMonths']))}</span>
          </MetricCell>
          <MetricCell label="Cash Burn">
            <span className="font-mono tabular-nums">{formatMoney(getField(row, ['cash_burn', 'cashBurn']))}</span>
          </MetricCell>
          <MetricCell label="Shelf Capacity">
            <span className="font-mono tabular-nums">{formatMoney(getField(row, ['shelf_capacity', 'shelfCapacity']))}</span>
          </MetricCell>
          <MetricCell label="Offerings (2yr)">
            <span className="font-mono tabular-nums">{formatPrimitive(getField(row, ['offering_count_2y', 'offeringCount2y']))}</span>
          </MetricCell>
          <MetricCell label="Has Pending S-1">
            {formatBoolean(getField(row, ['has_pending_s1', 'hasPendingS1']))}
          </MetricCell>
          <MetricCell label="RegSHO">
            {formatBoolean(getField(row, ['regsho']))}
          </MetricCell>
        </div>
      ) : null}
      {!loading && !state.error && !state.payload ? <NoDataBadge /> : null}
    </div>
  );
}
