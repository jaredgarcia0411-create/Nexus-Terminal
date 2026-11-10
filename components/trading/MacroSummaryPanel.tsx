'use client';

import { useEffect, useRef, useState } from 'react';

// Local mirror of MacroSummaryReport (lib/agents/types.ts). Duplicated rather
// than imported so this client component doesn't pull the agent module into
// the browser bundle. Keep in sync with the source of truth.
type Bias = 'bullish' | 'bearish' | 'neutral';
type Confidence = 'high' | 'medium' | 'low';
type Impact = 'positive' | 'negative' | 'mixed';
type Rating = 'green' | 'yellow' | 'red';

interface MacroDriver {
  driver: string;
  impact: Impact;
  sourceRefs: string[];
}

interface KeyLevel {
  ticker: string;
  support: string;
  resistance: string;
  note: string;
}

interface FredDataPoint {
  seriesId: string;
  label: string;
  date: string;
  value: number | null;
}

interface ScheduledCatalyst {
  event: string;
  date: string | null;
  expectedImpact: string;
}

interface ScenarioAnalysis {
  consensus: string;
  disruption: string;
}

interface CrossAssetEntry {
  ticker: string;
  price: number | null;
  changePercent: number | null;
}

interface MacroSource {
  id: string;
  title: string;
  url: string | null;
  fetchedAt: string;
}

interface SentimentDataPoint {
  score: number;
  classification: string;
  source: string;
}

interface MacroSummaryReport {
  tradingDate: string;
  marketBias: Bias;
  summary: string;
  riskAssessment?: string;
  drivers: MacroDriver[];
  crossAssetSnapshot: CrossAssetEntry[];
  keyLevels: KeyLevel[];
  ratesOutlook: string;
  fredData: FredDataPoint[];
  sentimentData?: SentimentDataPoint;
  scheduledCatalysts: ScheduledCatalyst[];
  sectorRotation?: string[];
  scenarioAnalysis: ScenarioAnalysis;
  deskImplications?: string[];
  sourceIndex: MacroSource[];
  confidence: Confidence;
  tldr?: string[];
  deltas?: string[];
}

interface ApiResponse {
  summary: {
    generated_at: string | null;
    content: MacroSummaryReport;
    status: string;
    deliveryError: string | null;
  } | null;
}

// Module-level cache so flipping tabs doesn't refetch the same report.
let cachedReport: { report: MacroSummaryReport; generatedAt: string | null } | null = null;

// The 9 ETFs shown in the price grid (3 rows of 3), same set as the Discord header card.
const TAPE_TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'XLF', 'TLT', 'GLD', 'UVXY'];
const RATE_LABELS: Record<string, string> = { DGS10: '10Y', DGS2: '2Y', T10Y2Y: 'Curve' };

// Bias pill tint. Data-meaning colors: emerald = bullish, rose = bearish, amber = neutral.
const BIAS_PILL: Record<Bias, string> = {
  bullish: 'bg-emerald-500/10 text-emerald-400',
  bearish: 'bg-rose-500/10 text-rose-400',
  neutral: 'bg-amber-500/10 text-amber-300',
};

function impactToRating(impact: Impact): Rating {
  if (impact === 'positive') return 'green';
  if (impact === 'negative') return 'red';
  return 'yellow';
}

function dotClass(rating: Rating): string {
  if (rating === 'red') return 'bg-rose-500';
  if (rating === 'yellow') return 'bg-amber-500';
  return 'bg-emerald-500';
}

// mt-1.5 lines the dot up with the first line of text when a driver wraps to two lines.
function RatingDot({ rating }: { rating: Rating }) {
  return (
    <span
      role="img"
      aria-label={`${rating} rating`}
      className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(rating)}`}
    />
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h5 className="mb-1 text-sm font-semibold text-foreground">{children}</h5>;
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold capitalize ${className}`}>{children}</span>;
}

function formatFredValue(point: FredDataPoint): string {
  if (point.value === null) return 'n/a';
  if (point.seriesId === 'T10Y2Y') {
    const bp = Math.round(point.value * 100);
    return `${bp >= 0 ? '+' : ''}${bp}bp`;
  }
  return `${point.value.toFixed(2)}%`;
}

// Uses a real minus sign (−) so negative numbers line up with positive ones in mono font.
function formatChange(value: number): string {
  return `${value >= 0 ? '+' : '\u2212'}${Math.abs(value).toFixed(2)}%`;
}

// 'YYYY-MM-DD' -> 'Tue, Nov 10'. Noon UTC keeps the date from shifting a day in any timezone.
function shortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function MacroSummaryPanel() {
  const [report, setReport] = useState<MacroSummaryReport | null>(cachedReport?.report ?? null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(cachedReport?.generatedAt ?? null);
  const [status, setStatus] = useState<'idle' | 'loading'>(cachedReport ? 'idle' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (cachedReport) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch('/api/agents/macro-summary/latest', { signal: controller.signal });
        if (!res.ok) throw new Error(`Macro summary fetch failed: ${res.status}`);
        const payload = (await res.json()) as ApiResponse;

        if (payload.summary?.content) {
          cachedReport = {
            report: payload.summary.content,
            generatedAt: payload.summary.generated_at,
          };
          setReport(payload.summary.content);
          setGeneratedAt(payload.summary.generated_at);
        }
        setStatus('idle');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Macro summary unavailable');
        setStatus('idle');
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="rounded border border-border bg-accent px-4 py-6 text-center text-sm text-muted-foreground">
        Loading macro briefing…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-border bg-accent px-4 py-6 text-center text-sm text-rose-400">
        {error}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded border border-border bg-accent px-4 py-6 text-center text-sm text-muted-foreground">
        Macro briefing not available yet.
      </div>
    );
  }

  const tape = TAPE_TICKERS.flatMap((ticker) => {
    const entry = report.crossAssetSnapshot.find((item) => item.ticker === ticker);
    return entry && entry.price !== null && entry.changePercent !== null
      ? [{ ticker, price: entry.price, changePercent: entry.changePercent }]
      : [];
  });
  const rates = Object.keys(RATE_LABELS).flatMap((seriesId) => {
    const point = report.fredData.find((item) => item.seriesId === seriesId);
    return point && point.value !== null ? [{ label: RATE_LABELS[seriesId], value: formatFredValue(point) }] : [];
  });
  const levelNotes = report.keyLevels
    .filter((level) => level.note?.trim())
    .map((level) => `${level.ticker}: ${level.note.trim()}`);
  const sentiment = report.sentimentData;
  const generatedTime = generatedAt
    ? new Date(generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    // @container lets the two-column split key off the panel's own width (not the screen's),
    // so it stays one column inside the narrower expand dialog.
    <div className="@container space-y-4 rounded border border-border bg-accent p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Bias</span>
          <Pill className={BIAS_PILL[report.marketBias] ?? BIAS_PILL.neutral}>{report.marketBias}</Pill>
          <span className="text-xs text-muted-foreground">Confidence</span>
          <Pill className="bg-card font-medium text-foreground">{report.confidence}</Pill>
          {sentiment ? (
            <>
              <span className="text-xs text-muted-foreground">Fear &amp; Greed</span>
              <Pill className="bg-card font-mono font-medium tabular-nums text-foreground">
                {sentiment.score} · {sentiment.classification}
              </Pill>
            </>
          ) : null}
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {shortDate(report.tradingDate)}
          {generatedTime ? ` · ${generatedTime}` : ''}
        </span>
      </div>

      {/* 5-column grid at 768px+ panel width: the story takes 3, the numbers take 2. */}
      <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-5">
        <div className="min-w-0 space-y-4 @3xl:col-span-3">
          {report.summary ? <p className="text-sm text-foreground">{report.summary}</p> : null}

          {report.drivers.length > 0 ? (
            <div>
              <SectionHeading>Drivers</SectionHeading>
              <ul className="space-y-1.5">
                {report.drivers.slice(0, 3).map((d, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <RatingDot rating={impactToRating(d.impact)} />
                    <span className="text-sm text-foreground">{d.driver}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.scheduledCatalysts.length > 0 ? (
            <div>
              <SectionHeading>This week</SectionHeading>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {report.scheduledCatalysts.slice(0, 3).map((c, i) => (
                  <li key={i}>
                    {c.event} · {c.date ? shortDate(c.date) : 'date TBD'}
                    {c.expectedImpact ? ` — ${c.expectedImpact}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(report.scenarioAnalysis?.consensus || report.scenarioAnalysis?.disruption) ? (
            <div>
              <SectionHeading>Scenarios</SectionHeading>
              <div className="space-y-2 text-sm text-foreground">
                {report.scenarioAnalysis.consensus ? (
                  <p>
                    <span className="font-semibold text-emerald-400">Base case </span>
                    {report.scenarioAnalysis.consensus}
                  </p>
                ) : null}
                {report.scenarioAnalysis.disruption ? (
                  <p>
                    <span className="font-semibold text-rose-400">What breaks it </span>
                    {report.scenarioAnalysis.disruption}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4 @3xl:col-span-2">
          {tape.length > 0 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {tape.map((entry) => (
                <div key={entry.ticker} className="min-w-0 rounded bg-card px-2 py-1.5 text-xs">
                  <div className="font-semibold text-foreground">{entry.ticker}</div>
                  <div className="font-mono tabular-nums text-foreground">{entry.price.toFixed(2)}</div>
                  <div
                    className={`font-mono tabular-nums ${entry.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    {formatChange(entry.changePercent)}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {report.keyLevels.length > 0 ? (
            <div>
              <SectionHeading>Key levels</SectionHeading>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs tracking-wider text-foreground">
                    <th className="pb-1 text-left font-normal">Ticker</th>
                    <th className="pb-1 text-right font-normal">Support</th>
                    <th className="pb-1 text-right font-normal">Resistance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.keyLevels.map((level) => (
                    <tr key={level.ticker} className="border-t border-border">
                      <td className="py-1 font-semibold text-foreground">{level.ticker}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-foreground">{level.support}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-foreground">{level.resistance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {levelNotes.length > 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">{levelNotes.join(' · ')}</p>
              ) : null}
            </div>
          ) : null}

          {(rates.length > 0 || report.ratesOutlook) ? (
            <div>
              <SectionHeading>Rates</SectionHeading>
              {rates.length > 0 ? (
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-sm">
                  {rates.map((rate) => (
                    <span key={rate.label}>
                      <span className="text-muted-foreground">{rate.label}</span>{' '}
                      <span className="font-mono tabular-nums text-foreground">{rate.value}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {report.ratesOutlook ? <p className="mt-1 text-sm text-foreground">{report.ratesOutlook}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
