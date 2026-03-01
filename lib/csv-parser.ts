import { Trade, Direction } from './types';
import { parsePrice } from './trading-utils';
import { format } from 'date-fns';

export interface RawExecution {
  qty: number;
  price: number;
  time: string;
  commission: number;
  fees: number;
}

export interface SymbolExecutions {
  shortEntry: RawExecution[];
  shortExit: RawExecution[];
  longEntry: RawExecution[];
  longExit: RawExecution[];
}

export const parseDateFromFilename = (filename: string) => {
  const base = filename.replace(/\.csv$/i, '');
  const numbers = base.match(/\d+/g);
  if (!numbers || numbers.length < 3) return null;
  
  const nums = numbers.slice(-3);
  const month = parseInt(nums[0], 10);
  const day = parseInt(nums[1], 10);
  let year = parseInt(nums[2], 10);
  
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 100) year = 2000 + year;
  
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  
  return {
    date,
    sortKey: format(date, 'yyyy-MM-dd')
  };
};

export const processCsvData = (data: any[], dateInfo: { date: Date, sortKey: string }): Trade[] => {
  const symbolMap: Record<string, SymbolExecutions> = {};
  const parseCost = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
    if (typeof value !== 'string') return 0;
    const cleaned = value.replace(/[$,\s]/g, '').trim();
    if (!cleaned) return 0;
    const normalized = cleaned.startsWith('(') && cleaned.endsWith(')')
      ? `-${cleaned.slice(1, -1)}`
      : cleaned;
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  };

  data.forEach(row => {
    const sym = (row.Symbol || '').toUpperCase().trim();
    const side = (row.Side || '').toUpperCase().trim();
    const qty = parseFloat(row.Qty || row.Quantity) || 0;
    const price = parsePrice(row.Price);
    const time = row.Time || '';
    const commission = parseCost(row.Commission || row.Comm);
    const fees = parseCost(row.Fees || row.Fee);

    if (!sym || !side || qty === 0) return;

    if (!symbolMap[sym]) {
      symbolMap[sym] = { shortEntry: [], shortExit: [], longEntry: [], longExit: [] };
    }

    // Logic based on user request:
    // Long: MARGIN (Buy), S (Sell)
    // Short: SS (Short Sell), B (Buy back)
    if (side === 'SS') symbolMap[sym].shortEntry.push({ qty, price, time, commission, fees });
    else if (side === 'B') symbolMap[sym].shortExit.push({ qty, price, time, commission, fees });
    else if (side === 'MARGIN') symbolMap[sym].longEntry.push({ qty, price, time, commission, fees });
    else if (side === 'S') symbolMap[sym].longExit.push({ qty, price, time, commission, fees });
  });

  const matchedPairs: any[] = [];

  Object.entries(symbolMap).forEach(([sym, d]) => {
    // Match Short trades
    const se = [...d.shortEntry];
    const sx = [...d.shortExit];
    while (se.length && sx.length) {
      const entry = se.shift()!;
      const exit = sx.shift()!;
      const q = Math.min(entry.qty, exit.qty);
      const commission = ((entry.commission / entry.qty) * q) + ((exit.commission / exit.qty) * q);
      const fees = ((entry.fees / entry.qty) * q) + ((exit.fees / exit.qty) * q);
      
      matchedPairs.push({
        symbol: sym,
        direction: 'SHORT' as Direction,
        entryPrice: entry.price,
        exitPrice: exit.price,
        qty: q,
        commission,
        fees,
        pnl: ((entry.price - exit.price) * q) - commission - fees,
      });

      if (entry.qty > exit.qty) se.unshift({ ...entry, qty: entry.qty - q });
      else if (exit.qty > entry.qty) sx.unshift({ ...exit, qty: exit.qty - q });
    }

    // Match Long trades
    const le = [...d.longEntry];
    const lx = [...d.longExit];
    while (le.length && lx.length) {
      const entry = le.shift()!;
      const exit = lx.shift()!;
      const q = Math.min(entry.qty, exit.qty);
      const commission = ((entry.commission / entry.qty) * q) + ((exit.commission / exit.qty) * q);
      const fees = ((entry.fees / entry.qty) * q) + ((exit.fees / exit.qty) * q);
      
      matchedPairs.push({
        symbol: sym,
        direction: 'LONG' as Direction,
        entryPrice: entry.price,
        exitPrice: exit.price,
        qty: q,
        commission,
        fees,
        pnl: ((exit.price - entry.price) * q) - commission - fees,
      });

      if (entry.qty > exit.qty) le.unshift({ ...entry, qty: entry.qty - q });
      else if (exit.qty > entry.qty) lx.unshift({ ...exit, qty: exit.qty - q });
    }
  });

  // Merge matched pairs by symbol and direction
  const mergedMap: Record<string, Trade> = {};

  matchedPairs.forEach(pair => {
    const key = `${dateInfo.sortKey}|${pair.symbol}|${pair.direction}`;
    if (!mergedMap[key]) {
      mergedMap[key] = {
        id: key,
        date: dateInfo.date,
        sortKey: dateInfo.sortKey,
        symbol: pair.symbol,
        direction: pair.direction,
        avgEntryPrice: 0,
        avgExitPrice: 0,
        totalQuantity: 0,
        pnl: 0,
        executions: 0,
        commission: 0,
        fees: 0,
        tags: []
      };
    }

    const trade = mergedMap[key];
    
    // Set time from first entry execution if not set
    if (trade.date.getHours() === 0 && trade.date.getMinutes() === 0) {
      const firstEntry = pair.direction === 'LONG' 
        ? symbolMap[pair.symbol].longEntry[0] 
        : symbolMap[pair.symbol].shortEntry[0];
      
      if (firstEntry && firstEntry.time) {
        const timeParts = firstEntry.time.split(':');
        if (timeParts.length >= 2) {
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          const seconds = timeParts.length > 2 ? parseInt(timeParts[2], 10) : 0;
          
          const newDate = new Date(trade.date);
          newDate.setHours(hours, minutes, seconds);
          trade.date = newDate;
        }
      }
    }

    const entryValue = trade.avgEntryPrice * trade.totalQuantity + pair.entryPrice * pair.qty;
    const exitValue = trade.avgExitPrice * trade.totalQuantity + pair.exitPrice * pair.qty;
    
    trade.totalQuantity += pair.qty;
    trade.pnl += pair.pnl;
    trade.commission = (trade.commission || 0) + pair.commission;
    trade.fees = (trade.fees || 0) + pair.fees;
    trade.executions++;
    trade.avgEntryPrice = entryValue / trade.totalQuantity;
    trade.avgExitPrice = exitValue / trade.totalQuantity;
  });

  return Object.values(mergedMap);
};
