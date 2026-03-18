import { getDb } from './db.js';
import { importedResearchReports } from './schema.js';

/**
 * Query the imported_research_reports table for distinct tickers.
 * Returns a deduplicated array of ticker symbols.
 *
 * These are tickers from Discord research reports that we want to
 * subscribe to via Schwab's LEVELONE_EQUITIES stream so they appear
 * in the scanner with real-time quote data.
 */
export async function loadImportedTickers(): Promise<string[]> {
  const db = getDb();

  const rows = await db
    .selectDistinct({ ticker: importedResearchReports.ticker })
    .from(importedResearchReports);

  return rows.map((r) => r.ticker);
}
