import { describe, expect, it } from 'vitest';

import { buildStructuredFallbackFromSources, formatStructuredMessage, parseJarvisLlmResponse } from '@/lib/jarvis-response';

describe('parseJarvisLlmResponse', () => {
  it('parses strict JSON payloads from the model', () => {
    const payload = parseJarvisLlmResponse('{"tldr":"Earnings beat expectations","findings":["AAPL surprised","Guidance raised"],"actionSteps":["Trim risk","Hedge positions"],"risks":["Macro weakness"]}');

    expect(payload.structured).toEqual({
      tldr: 'Earnings beat expectations',
      findings: ['AAPL surprised', 'Guidance raised'],
      actionSteps: ['Trim risk', 'Hedge positions'],
      risks: ['Macro weakness'],
    });
    expect(payload.message).toContain('TL;DR: Earnings beat expectations');
  });

  it('extracts JSON from code-fenced model responses', () => {
    const payload = parseJarvisLlmResponse('```json\n{"tldr":"Macro steady","findings":[],"actionSteps":["Review levels"],"risks":["Higher rates"]}\n```');
    expect(payload.structured?.actionSteps).toEqual(['Review levels']);
    expect(payload.message).toContain('Findings');
  });

  it('falls back to raw text when parse fails', () => {
    const payload = parseJarvisLlmResponse('Here is your analysis without JSON output.');
    expect(payload.message).toBe('Here is your analysis without JSON output.');
    expect(payload.structured).toEqual({
      tldr: 'Here is your analysis without JSON output.',
      findings: ['Here is your analysis without JSON output.'],
      actionSteps: ['Review the findings and map them to a concrete risk-aware action plan.'],
      risks: ['No explicit risk section was returned by the model.'],
    });
  });
});

describe('formatStructuredMessage', () => {
  it('renders empty sections as placeholders', () => {
    const output = formatStructuredMessage({
      tldr: 'Done',
      findings: [],
      actionSteps: [],
      risks: [],
    });

    expect(output).toContain('Findings');
    expect(output).toContain('- No items identified.');
  });
});

describe('buildStructuredFallbackFromSources', () => {
  it('builds schema-compatible sections from source context', () => {
    const structured = buildStructuredFallbackFromSources({
      prompt: 'Summarize risks',
      sourceSummary: 'SEC filing · sec.gov',
      sources: [
        {
          host: 'www.sec.gov',
          title: 'Filing A',
          excerpt: 'Company posted stronger margins this quarter.',
          relevance: 0.82,
          tickers: ['AAPL'],
        },
      ],
      warnings: ['Domain blocked'],
    });

    expect(structured.tldr).toBe('SEC filing · sec.gov');
    expect(structured.findings).toEqual(['www.sec.gov · Filing A: Company posted stronger margins this quarter.']);
    expect(structured.actionSteps.length).toBeGreaterThan(1);
    expect(structured.actionSteps.join(' ')).toContain('AAPL');
    expect(structured.risks).toEqual(['Domain blocked']);
  });

  it('adds deterministic low-confidence risk when no sources exist', () => {
    const structured = buildStructuredFallbackFromSources({
      prompt: '',
      sourceSummary: '',
      sources: [],
    });

    expect(structured.tldr).toBe('Fallback context was used because the LLM payload was unavailable.');
    expect(structured.findings).toEqual(['No valid source chunks were available.']);
    expect(structured.actionSteps).toEqual(['Validate position risk and sizing before taking action.']);
    expect(structured.risks).toEqual(['No valid source chunks were available, so confidence is low.']);
  });
});
