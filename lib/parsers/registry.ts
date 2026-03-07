import type { BrokerParserConfig } from './types';
import { defaultParser } from './default';

const parsers: BrokerParserConfig[] = [defaultParser];

export function registerParser(parser: BrokerParserConfig) {
  const existingIdx = parsers.findIndex((p) => p.id === parser.id);
  if (existingIdx >= 0) {
    parsers.splice(existingIdx, 1);
  }

  // Insert before default so auto-detect prefers specific parsers
  const defaultIdx = parsers.findIndex((p) => p.id === 'default');
  if (defaultIdx >= 0) {
    parsers.splice(defaultIdx, 0, parser);
  } else {
    parsers.push(parser);
  }
}

export function detectParser(headers: string[], rows: Record<string, unknown>[]): BrokerParserConfig {
  for (const parser of parsers) {
    if (parser.detect(headers, rows)) {
      return parser;
    }
  }
  return defaultParser;
}

export function getParserById(id: string): BrokerParserConfig | undefined {
  return parsers.find((p) => p.id === id);
}
