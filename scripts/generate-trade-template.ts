/**
 * generate-trade-template.ts
 *
 * Reads screenshot filenames from scripts/trade-screenshots/ and generates
 * a blank annotation template at scripts/trade-examples-template.json.
 *
 * Each screenshot filename should follow the pattern:
 *   "3-26-26 VCX.jpg" or "8-14-25 BMNR 2.png"
 *   Format: M-DD-YY TICKER [optional number].ext
 *
 * Usage: npx tsx scripts/generate-trade-template.ts
 */

import { readdirSync, writeFileSync } from "fs";
import { join } from "path";

// Directory containing Mike's trade screenshots
const SCREENSHOTS_DIR = join(__dirname, "trade-screenshots");
// Output template file
const OUTPUT_FILE = join(__dirname, "trade-examples-template.json");

// Regex: captures date (M-DD-YY) and ticker (uppercase letters)
// Examples: "3-26-26 VCX.jpg" → date="3-26-26", ticker="VCX"
//           "8-14-25 BMNR 2.png" → date="8-14-25", ticker="BMNR"
const FILENAME_REGEX = /^(\d{1,2}-\d{1,2}-\d{2})\s+([A-Z]+)\s*\d*\.(png|jpg|jpeg)$/i;

interface TradeTemplate {
  filename: string;
  ticker: string;
  tradeDate: string;
  direction: "" | "short" | "long";
  agentTarget: "" | "small-cap" | "swing" | "both";
  entryPrice: number | null;
  exitPrice: number | null;
  outcome: "" | "win" | "loss" | "breakeven";
  patternCategory: string;
  intradayNotes: string;
  dailyNotes: string;
  volumeNotes: string;
  exclude: boolean;
}

/**
 * Converts a date string like "3-26-26" to "2026-03-26".
 * Assumes 20xx century for two-digit years.
 */
function parseDate(raw: string): string {
  const [month, day, year] = raw.split("-");
  const fullYear = `20${year.padStart(2, "0")}`;
  return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function main() {
  // Read all files from the screenshots directory
  let files: string[];
  try {
    files = readdirSync(SCREENSHOTS_DIR);
  } catch {
    console.error(`\nError: Directory not found: ${SCREENSHOTS_DIR}`);
    console.error(`\nCreate it and add trade screenshots first:`);
    console.error(`  mkdir -p scripts/trade-screenshots`);
    console.error(`  # Copy/unzip screenshots into that folder\n`);
    process.exit(1);
  }

  // Filter to image files that match the expected naming pattern
  const matched: TradeTemplate[] = [];
  const skipped: string[] = [];

  for (const file of files.sort()) {
    const match = file.match(FILENAME_REGEX);
    if (match) {
      matched.push({
        filename: file,
        ticker: match[2].toUpperCase(),
        tradeDate: parseDate(match[1]),
        direction: "",
        agentTarget: "",
        entryPrice: null,
        exitPrice: null,
        outcome: "",
        patternCategory: "",
        intradayNotes: "",
        dailyNotes: "",
        volumeNotes: "",
        exclude: false,
      });
    } else {
      skipped.push(file);
    }
  }

  if (matched.length === 0) {
    console.error(`\nNo matching screenshots found in ${SCREENSHOTS_DIR}`);
    console.error(`Expected filename format: "3-26-26 VCX.jpg" (M-DD-YY TICKER.ext)\n`);
    process.exit(1);
  }

  // Write the template
  writeFileSync(OUTPUT_FILE, JSON.stringify(matched, null, 2) + "\n");

  // Summary
  console.log(`\nGenerated ${matched.length} trade entries → ${OUTPUT_FILE}`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} files (didn't match pattern):`);
    skipped.forEach((f) => console.log(`  - ${f}`));
  }

  // Show unique tickers
  const tickers = [...new Set(matched.map((t) => t.ticker))].sort();
  console.log(`\nUnique tickers (${tickers.length}): ${tickers.join(", ")}`);
  console.log(`\nNext step: Open ${OUTPUT_FILE} and fill in each trade's details.`);
  console.log(`See Section 27 of AGENTIC_EXPANSIONV2.md for field definitions.\n`);
}

main();
