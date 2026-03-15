import type { JarvisContext } from '@/lib/jarvis/types';

export const JARVIS_SYSTEM_PROMPT = `
# JARVIS - Nexus Terminal AI Layer

## Identity
You are Jarvis, the trading intelligence layer for Nexus Terminal.
You are not a general assistant. You only reason about:
- Equities, dilution, float, market structure
- The user's trade history and performance patterns
- Macro conditions relevant to the user's traded symbols

## Scope Constraints
- Never give financial advice or price targets
- Never fabricate data. If a field is missing, say "No data"
- Always cite which data source a claim comes from
- Flag when you are reasoning without live data

## Context Injected Per Request
You will receive a JSON block called <context> containing:
- user_trades: last 30 days of trades (symbol, direction, pnl, r_multiple)
- macro_summary: today's macro summary if available
- memory: relevant agent_memory rows for this user
- report_data: raw API data for research reports (if applicable)

## Output Formats

### Research Report
Return structured JSON matching ResearchReportSchema.
Never add fields not in the schema. Mark missing data as null, not "N/A" string.

### Trade Analysis
Return: strengths[], weaknesses[], patterns[], action_items[]
Ground every claim in the provided trade data.

### Macro Summary
Return: headline, key_themes[], risk_flags[], watchlist_notes[]
Max 300 words. Cite source URLs inline.

### Chat Response
Conversational. Reference context when relevant.
If asked about a ticker not in context, say you need to run a research report first.

## Data Sources
- AskEdgar API: dilution, float, cash need, warrants
- Macro URLs: [configured in macro cron]
- Trades DB: injected via context
- Research reports: stored in DB, injected when relevant

## Memory Rules
After every trade analysis, extract:
- New behavioral patterns observed
- Symbols the user trades frequently
Write these to agent_memory with category='trade_insight'
`;

function withContext(instruction: string, context: JarvisContext) {
  return `${instruction}\n\n<context>\n${JSON.stringify(context)}\n</context>`;
}

export function buildTradeAnalysisPrompt(context: JarvisContext) {
  return withContext(
    [
      'You are running trade-analysis mode.',
      'Output strict JSON with this shape only:',
      '{"strengths": string[], "weaknesses": string[], "patterns": string[], "action_items": string[]}',
      'Each array should have 1-5 concise items grounded in trade data.',
    ].join('\n'),
    context,
  );
}

export function buildMacroPrompt(context: JarvisContext) {
  return withContext(
    [
      'You are running macro mode.',
      'Output strict JSON with this shape only:',
      '{"headline": string, "key_themes": string[], "risk_flags": string[], "watchlist_notes": string[]}',
      'Use only the macro source pages in report_data.pages as evidence.',
      'Cite source URLs inline where relevant.',
      'Prioritize concrete, actionable information for an active trader.',
      'Include major drivers for: index trend, rates/liquidity, volatility, commodities/energy, and risk events.',
      'If a source has no useful data, skip it instead of inventing details.',
      'Keep each bullet concise and specific.',
    ].join('\n'),
    context,
  );
}

// Compact schema — keeps token count low while giving the LLM the exact shape it must return.
// Each top-level key maps to a type shorthand: s=string, n=number|null, b=boolean, []= array of objects.
const RESEARCH_SCHEMA = `
Return ONLY valid JSON. null for missing numbers, "" for missing strings, [] for missing arrays. Ratings: "High"|"Medium"|"Low"|"".
{
  "ticker":"s","generatedAt":"s (ISO 8601)",
  "header":{"price":n,"marketCap":n,"float":n,"outstanding":n,"country":"s","industry":"s","sector":"s","isAdr":b,"gain1d":n,"gain7d":n,"gain30d":n,"volume":n,"avgVolume":n,"shortFloat":n,"shortInterest":n,"feeRate":n,"insiderPercent":n,"affiliatePercent":n,"institutionsPercent":n},
  "dataSources":[{"endpoint":"s","label":"s","hasData":b,"error":"s?"}],
  "news":[{"title":"s","summary":"s","body":"s","filedAt":"s","formType":"s","author":"s","tags":["s"],"isNews":b}],
  "catalysts":[{"type":"s","description":"s","date":"s","risk":"s?","source":"news|compliance"}],
  "dilution":{"rating":"s","description":"s","warrantExercise":"s","warrantExerciseDesc":"s","warrants":[{"details":"s","amount":n,"remaining":n,"exercisePrice":n,"registered":"s","exercisableDate":"s","expirationDate":"s","filedAt":"s"}],"convertibles":[{"details":"s","conversionPrice":n,"registered":"s","convertibleDate":"s","maturityDate":"s","offeringAmount":n,"debtRemaining":n,"sharesRemaining":n,"filedAt":"s"}]},
  "offeringFrequency":{"rating":"s","description":"s","offerings":[{"headline":"s","filedAt":"s","formType":"s","offeringType":"s","sharesAmount":n,"warrantsAmount":n,"sharePrice":n,"offeringAmount":n,"conversionPrice":n}]},
  "offeringAbility":{"rating":"s","description":"s","registrations":[{"headline":"s","filedAt":"s","effectiveDate":"s","expirationDate":"s","effectiveStatus":b,"offeringAmount":n,"isAtm":b,"bank":"s","amountRemainingAtm":n,"totalRaised":n,"overBabyShelf":b}]},
  "cashNeed":{"rating":"s","description":"s","estimatedCash":n,"cashBurn":n,"cashRemainingMonths":n,"totalDebt":n},
  "managementCommentary":"s",
  "overallOfferingRisk":{"rating":"s","regsho":b,"nasdaqCompliance":"s","nasdaqComplianceDesc":"s"},
  "scamRisk":{"countryRisk":"s","floatRisk":"s","underwriterRisk":"s","scamRisk":"s","scamDescription":"s","liquidationHistory":"s","numberOfLiquidations":n,"lastLiquidationDate":"s","ipoDate":"s","lockUpExpiration":"s","underwriters":"s"},
  "agreements":[{"agreementType":"s","investorNames":"s","filedAt":"s","registrationDeadline":n,"effectiveDeadline":n,"penalties":"s","restrictionDate":"s","durationInDays":n,"participationPercentage":"s","details":"s"}],
  "historicalFloat":[{"reportedDate":"s","outstandingShares":n,"float":n,"tradableFloat":n,"affiliatePercent":n,"insiderPercent":n,"institutionsPercent":n,"formType":"s"}],
  "reverseSplits":[{"executionDate":"s","splitFrom":n,"splitTo":n}],
  "filingTitles":[{"ticker":"s","headline":"s","filedAt":"s","formType":"s"}]
}

`;

export function buildResearchPrompt(reportData: Record<string, unknown[]>) {
  // Skip the full JarvisContext wrapper — research only needs report_data.
  // Using compact JSON (no indentation) to minimize token count.
  return `You are running research mode.\n${RESEARCH_SCHEMA}\n\n<report_data>\n${JSON.stringify(reportData)}\n</report_data>`;
}

export function buildChatPrompt(context: JarvisContext, userMessage: string) {
  return withContext(`You are running chat mode. User message: ${userMessage}`, context);
}
