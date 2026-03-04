import { dasTraderParser } from './das-trader';
import { registerParser } from './registry';

registerParser(dasTraderParser);

export type { BrokerParserConfig, NormalizedExecution } from './types';
export { defaultParser, normalizeColumnNames } from './default';
export { dasTraderParser } from './das-trader';
export { registerParser, detectParser, getParserById, getAllParsers } from './registry';
