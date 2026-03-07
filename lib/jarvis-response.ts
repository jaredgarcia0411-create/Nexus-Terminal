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
  sources: { host: string; title: string }[];
  warnings?: string[];
}) {
  const findings = params.sources.map((source) => `${source.host} · ${source.title}`);

  if (findings.length === 0) {
    findings.push('No valid source chunks were available.');
  }

  return {
    tldr: params.sourceSummary || 'Fallback context was used because the LLM payload was unavailable.',
    findings,
    actionSteps: params.prompt
      ? [`Use your judgment with the available context for: ${params.prompt.slice(0, 160)}`]
      : ['Validate position risk and sizing before taking action.'],
    risks: params.warnings && params.warnings.length > 0
      ? params.warnings
      : ['No immediate source-level risk warning was captured.'],
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
