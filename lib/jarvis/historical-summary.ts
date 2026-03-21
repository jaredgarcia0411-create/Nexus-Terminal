import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { importedResearchReports, tickerResearchSummaries } from '@/lib/db/schema';
import type { ParsedReportFull } from '@/lib/discord/parser';

export interface HistoricalChange {
  date: string;
  field: string;
  from: string | null;
  to: string | null;
  description: string;
}

export interface RiskSnapshot {
  date: string;
  dilutionRisk: string | null;
  offeringRisk: string | null;
  scamRisk: string | null;
  cashBurnRisk: string | null;
}

export interface HistoricalSummaryData {
  changes: HistoricalChange[];
  riskTimeline: RiskSnapshot[];
  keyEvents: Array<{ date: string; event: string }>;
}

const RISK_FIELDS = ['dilutionRisk', 'offeringRisk', 'scamRisk', 'cashBurnRisk'] as const;

function isFullReport(json: unknown): json is ParsedReportFull {
  return typeof json === 'object' && json !== null && 'ticker' in json;
}

/**
 * Compare two reports and return what changed.
 * Pure function — no DB or LLM calls.
 */
export function computeHistoricalSummary(
  newReport: ParsedReportFull,
  previousReports: Array<{ reportDate: string; parsedJson: unknown }>,
): HistoricalSummaryData {
  const changes: HistoricalChange[] = [];
  const riskTimeline: RiskSnapshot[] = [];
  const keyEvents: Array<{ date: string; event: string }> = [];

  for (const previous of previousReports) {
    if (!isFullReport(previous.parsedJson)) continue;
    riskTimeline.push({
      date: previous.reportDate,
      dilutionRisk: previous.parsedJson.dilutionRisk,
      offeringRisk: previous.parsedJson.offeringRisk,
      scamRisk: previous.parsedJson.scamRisk,
      cashBurnRisk: previous.parsedJson.cashBurnRisk,
    });
  }

  const lastPrevious = previousReports.length > 0 ? previousReports[0] : null;
  if (lastPrevious && isFullReport(lastPrevious.parsedJson)) {
    const previous = lastPrevious.parsedJson;
    for (const field of RISK_FIELDS) {
      const oldValue = previous[field];
      const newValue = newReport[field];
      if (oldValue !== newValue && (oldValue || newValue)) {
        changes.push({
          date: new Date().toISOString(),
          field,
          from: oldValue,
          to: newValue,
          description: `${field} changed from ${oldValue ?? 'unknown'} to ${newValue ?? 'unknown'}`,
        });
      }
    }

    if (newReport.newsWhyRunning?.content && newReport.newsWhyRunning.content !== previous.newsWhyRunning?.content) {
      keyEvents.push({
        date: new Date().toISOString(),
        event: `New catalyst: ${newReport.newsWhyRunning.content.slice(0, 100)}`,
      });
    }
  }

  return { changes, riskTimeline, keyEvents };
}

/**
 * Update the pre-computed historical summary for a ticker.
 * Call this after each successful Discord report import.
 */
export async function updateTickerSummary(userId: string, ticker: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const reports = await db
    .select({
      reportDate: importedResearchReports.reportDate,
      parsedJson: importedResearchReports.parsedJson,
    })
    .from(importedResearchReports)
    .where(and(eq(importedResearchReports.userId, userId), eq(importedResearchReports.ticker, ticker)))
    .orderBy(desc(importedResearchReports.reportDate))
    .limit(50);

  if (reports.length === 0) return;

  const latest = reports[0];
  if (!isFullReport(latest.parsedJson)) return;

  const previousReports = reports.slice(1).map((report) => ({
    reportDate: report.reportDate.toISOString(),
    parsedJson: report.parsedJson,
  }));

  const summary = computeHistoricalSummary(latest.parsedJson, previousReports);

  await db
    .insert(tickerResearchSummaries)
    .values({
      id: crypto.randomUUID(),
      userId,
      ticker,
      reportCount: reports.length,
      latestReportDate: latest.reportDate,
      historicalSummary: summary,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tickerResearchSummaries.userId, tickerResearchSummaries.ticker],
      set: {
        reportCount: reports.length,
        latestReportDate: latest.reportDate,
        historicalSummary: summary,
        updatedAt: new Date(),
      },
    });
}
