import { z } from 'zod';
import { callLlm } from '@/lib/agents/llm-client';
import type { NewsItem } from '@/lib/triple-beat/data';

const MIN_QUOTE_CHARS = 12;

const earningsReadSchema = z.object({
  epsBeat: z.enum(['yes', 'no', 'unknown']),
  epsQuote: z.string(),
  revenueBeat: z.enum(['yes', 'no', 'unknown']),
  revenueQuote: z.string(),
  guidance: z.enum(['raised', 'maintained', 'lowered', 'none', 'unknown']),
  guidanceQuote: z.string(),
  mixedCatalyst: z.boolean(),
  note: z.string(),
});

export type EarningsRead = z.infer<typeof earningsReadSchema>;

export const UNKNOWN_EARNINGS_READ: EarningsRead = {
  epsBeat: 'unknown',
  epsQuote: '',
  revenueBeat: 'unknown',
  revenueQuote: '',
  guidance: 'unknown',
  guidanceQuote: '',
  mixedCatalyst: false,
  note: '',
};

const SYSTEM_PROMPT = `You read an earnings press release and news excerpts for one stock and classify the report.
Reply with JSON only, no prose and no code fences, in exactly this shape:
{"epsBeat":"yes|no|unknown","epsQuote":"","revenueBeat":"yes|no|unknown","revenueQuote":"","guidance":"raised|maintained|lowered|none|unknown","guidanceQuote":"","mixedCatalyst":false,"note":""}
Rules:
- epsBeat and revenueBeat compare the reported number with the analyst consensus estimate. Company guidance and prior-year results are not consensus. If no source states the consensus comparison, answer "unknown".
- guidance is "raised" only when the company increased its forward outlook versus its previous outlook, "maintained" when reaffirmed or unchanged, "lowered" when cut, "none" when a source says no outlook was given, otherwise "unknown".
- Each quote must be copied character-for-character from the sources, one sentence or less, and must contain the evidence for that answer. Use "" when the answer is "unknown".
- mixedCatalyst is true when the same report announces another major event that could explain the move: merger, acquisition, buyout, FDA decision, major contract, or offering.
- note is one plain sentence under 160 characters on what drove the report. No trading advice.`;

export function buildEarningsEvidence(pressRelease: string, news: NewsItem[]): string {
  const sections = news.map((item, index) => `[NEWS ${index + 1} · ${item.source}] ${item.title}\n${item.text}`);
  if (pressRelease) sections.unshift(`[PRESS RELEASE]\n${pressRelease}`);
  return sections.join('\n\n');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// The LLM may only point at evidence: an answer whose quote is not a verbatim excerpt of the inputs becomes unknown.
export function verifyEarningsRead(read: EarningsRead, evidence: string): EarningsRead {
  const source = normalize(evidence);
  const verified = (quote: string) => normalize(quote).length >= MIN_QUOTE_CHARS && source.includes(normalize(quote));
  return {
    ...read,
    epsBeat: verified(read.epsQuote) ? read.epsBeat : 'unknown',
    revenueBeat: verified(read.revenueQuote) ? read.revenueBeat : 'unknown',
    guidance: verified(read.guidanceQuote) ? read.guidance : 'unknown',
    note: read.note.slice(0, 200),
  };
}

// null means the LLM call or its JSON failed, so the replay knows not to cache it.
export async function classifyEarnings(ticker: string, evidence: string): Promise<EarningsRead | null> {
  if (!evidence) return UNKNOWN_EARNINGS_READ;
  try {
    const response = await callLlm({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `Ticker: ${ticker}\n\n${evidence}`,
      temperature: 0,
      maxTokens: 600,
    }, 'background');
    const json = response.content.replace(/^```(?:json)?\s*|\s*```$/g, '');
    return verifyEarningsRead(earningsReadSchema.parse(JSON.parse(json)), evidence);
  } catch (error) {
    console.warn('triple beat earnings read failed', ticker, error);
    return null;
  }
}
