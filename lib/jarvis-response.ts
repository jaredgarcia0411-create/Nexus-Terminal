import type { JarvisStructuredResponse } from '@/lib/jarvis-types';

interface ParsedJarvisLlmPayload {
  message: string;
  structured: JarvisStructuredResponse;
}

interface RawStructuredInput {
  tldr: unknown;
  findings: unknown;
  actionSteps: unknown;
  risks: unknown;
}

const EMPTY_SECTION_ITEM = 'No items identified.';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSectionList(value: unknown) {
  const normalized = normalizeStringList(value);
  return normalized.length > 0 ? normalized : [EMPTY_SECTION_ITEM];
}

function hasRequiredShape(payload: unknown): payload is RawStructuredInput {
  if (!payload || typeof payload !== 'object') return false;

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.tldr !== 'string') return false;
  if (!Array.isArray(candidate.findings) || !Array.isArray(candidate.actionSteps) || !Array.isArray(candidate.risks)) {
    return false;
  }

  return true;
}

export function formatStructuredMessage(structured: JarvisStructuredResponse) {
  const findings = structured.findings.length > 0
    ? structured.findings.map((item) => `- ${item}`).join('\n')
    : `- ${EMPTY_SECTION_ITEM}`;

  const actionSteps = structured.actionSteps.length > 0
    ? structured.actionSteps.map((item) => `- ${item}`).join('\n')
    : `- ${EMPTY_SECTION_ITEM}`;

  const risks = structured.risks.length > 0
    ? structured.risks.map((item) => `- ${item}`).join('\n')
    : `- ${EMPTY_SECTION_ITEM}`;

  return [`TL;DR: ${structured.tldr || EMPTY_SECTION_ITEM}`, 'Findings', findings, 'Action Steps', actionSteps, 'Risks', risks].join('\n\n');
}

export function buildStructuredFallbackFromText(rawContent: string): JarvisStructuredResponse {
  const normalized = normalizeString(rawContent);
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);

  const cleanedLines = lines
    .map((line) => line.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);

  const findings = cleanedLines.length > 0
    ? cleanedLines.slice(0, 5)
    : [EMPTY_SECTION_ITEM];

  return {
    tldr: normalized.slice(0, 140) || EMPTY_SECTION_ITEM,
    findings,
    actionSteps: ['Review the findings and map them to a concrete risk-aware action plan.'],
    risks: ['No explicit risk section was returned by the model.'],
  };
}

export function buildStructuredFallbackFromSources(params: {
  prompt?: string;
  sourceSummary?: string;
  sources: { host: string; title: string; excerpt?: string; relevance?: number; tickers?: string[] }[];
  warnings?: string[];
}) {
  const sortedSources = [...params.sources].sort((a, b) => {
    const relevanceDiff = (b.relevance ?? 0) - (a.relevance ?? 0);
    if (relevanceDiff !== 0) return relevanceDiff;
    const hostDiff = a.host.localeCompare(b.host);
    if (hostDiff !== 0) return hostDiff;
    return a.title.localeCompare(b.title);
  });

  const findings = sortedSources.length > 0
    ? sortedSources.slice(0, 5).map((source) => {
      const excerpt = normalizeString(source.excerpt).replace(/\s+/g, ' ').slice(0, 140);
      return excerpt
        ? `${source.host} · ${source.title}: ${excerpt}`
        : `${source.host} · ${source.title}`;
    })
    : ['No valid source chunks were available.'];

  const uniqueTickers = [...new Set(
    sortedSources
      .flatMap((source) => source.tickers ?? [])
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean),
  )].slice(0, 6);

  const actionSteps: string[] = [];
  if (params.prompt) {
    actionSteps.push(`Address the request directly: ${params.prompt.slice(0, 160)}`);
  }
  if (sortedSources[0]) {
    actionSteps.push(`Cross-check the top claim against ${sortedSources[0].host} before placing a trade.`);
  }
  if (uniqueTickers.length > 0) {
    actionSteps.push(`Validate catalyst timing and risk controls for ${uniqueTickers.join(', ')}.`);
  }
  if (actionSteps.length === 0) {
    actionSteps.push('Validate position risk and sizing before taking action.');
  }

  const warningRisks = normalizeStringList(params.warnings);
  const risks = warningRisks.length > 0
    ? warningRisks
    : sortedSources.length === 0
      ? ['No valid source chunks were available, so confidence is low.']
      : sortedSources.length < 2
        ? ['Only one source was available; verify with an additional independent source.']
        : ['This response was generated without a live model call and may miss nuance.'];

  const tldr = normalizeString(params.sourceSummary)
    || (sortedSources.length > 0
      ? `Fallback summary based on ${sortedSources.length} allowlisted source(s).`
      : 'Fallback context was used because the LLM payload was unavailable.');

  return {
    tldr,
    findings,
    actionSteps,
    risks,
  };
}

function parseStructuredPayload(raw: unknown): JarvisStructuredResponse | null {
  if (!hasRequiredShape(raw)) return null;

  return {
    tldr: normalizeString(raw.tldr),
    findings: normalizeSectionList(raw.findings),
    actionSteps: normalizeSectionList(raw.actionSteps),
    risks: normalizeSectionList(raw.risks),
  };
}

export function parseJarvisLlmResponse(rawContent: string): ParsedJarvisLlmPayload {
  const trimmed = rawContent.trim();

  if (!trimmed) {
    return {
      message: '',
      structured: {
        tldr: EMPTY_SECTION_ITEM,
        findings: [EMPTY_SECTION_ITEM],
        actionSteps: [EMPTY_SECTION_ITEM],
        risks: [EMPTY_SECTION_ITEM],
      },
    };
  }

  const parseCandidates = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    parseCandidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const content of parseCandidates) {
    try {
      const parsed = JSON.parse(content);
      const structured = parseStructuredPayload(parsed);
      if (!structured) {
        continue;
      }

      return {
        message: formatStructuredMessage(structured),
        structured,
      };
    } catch {
      // no-op
    }
  }

  return {
    message: trimmed,
    structured: buildStructuredFallbackFromText(trimmed),
  };
}
