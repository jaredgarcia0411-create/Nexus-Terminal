import { dasTraderParser } from './das-trader';
import { registerParser } from './registry';

registerParser(dasTraderParser);

export type { BrokerParserConfig, NormalizedExecution } from './types';
export { defaultParser } from './default';
export { dasTraderParser } from './das-trader';
export { detectParser, getParserById } from './registry';
