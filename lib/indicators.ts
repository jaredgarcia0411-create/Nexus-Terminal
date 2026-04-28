// Client-side technical indicator calculations

export interface OHLCData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function sma(data: number[], period: number): (number | null)[] {
  const safePeriod = Math.trunc(period);
  if (!Number.isFinite(safePeriod) || safePeriod <= 0) {
    return data.map(() => null);
  }

  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < safePeriod - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - safePeriod + 1; j <= i; j++) {
      sum += data[j];
    }
    result.push(sum / safePeriod);
  }
  return result;
}

export const sma20 = (data: number[]): (number | null)[] => sma(data, 20);
export const sma50 = (data: number[]): (number | null)[] => sma(data, 50);
export const sma200 = (data: number[]): (number | null)[] => sma(data, 200);

export function ema(data: number[], period: number): (number | null)[] {
  const safePeriod = Math.trunc(period);
  if (!Number.isFinite(safePeriod) || safePeriod <= 0) {
    return data.map(() => null);
  }

  const result: (number | null)[] = [];
  const multiplier = 2 / (safePeriod + 1);

  for (let i = 0; i < data.length; i++) {
    if (i < safePeriod - 1) {
      result.push(null);
      continue;
    }
    if (i === safePeriod - 1) {
      let sum = 0;
      for (let j = 0; j < safePeriod; j++) sum += data[j];
      result.push(sum / safePeriod);
      continue;
    }
    const prev = result[i - 1];
    if (prev === null) {
      result.push(null);
      continue;
    }
    result.push((data[i] - prev) * multiplier + prev);
  }
  return result;
}

export const ema9 = (data: number[]): (number | null)[] => ema(data, 9);
export const ema20 = (data: number[]): (number | null)[] => ema(data, 20);
export const ema21 = (data: number[]): (number | null)[] => ema(data, 21);
export const ema50 = (data: number[]): (number | null)[] => ema(data, 50);

export function bollingerBands(
  data: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const safePeriod = Math.trunc(period);
  if (!Number.isFinite(safePeriod) || safePeriod <= 0) {
    return {
      upper: data.map(() => null),
      middle: data.map(() => null),
      lower: data.map(() => null),
    };
  }

  const middle = sma(data, safePeriod);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    const mid = middle[i];
    if (mid === null || i < safePeriod - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }

    let sumSqDiff = 0;
    for (let j = i - safePeriod + 1; j <= i; j++) {
      sumSqDiff += (data[j] - mid) ** 2;
    }
    const stdDev = Math.sqrt(sumSqDiff / safePeriod);
    upper.push(mid + stdDevMultiplier * stdDev);
    lower.push(mid - stdDevMultiplier * stdDev);
  }

  return { upper, middle, lower };
}

export function vwap(candles: OHLCData[]): (number | null)[] {
  const result: (number | null)[] = [];
  let cumVolume = 0;
  let cumTP = 0;

  for (const candle of candles) {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume);

    if (![high, low, close].every(Number.isFinite)) {
      result.push(null);
      continue;
    }

    const typicalPrice = (high + low + close) / 3;
    const safeVolume = Number.isFinite(volume) ? volume : 0;

    cumVolume += safeVolume;
    cumTP += typicalPrice * safeVolume;
    result.push(cumVolume > 0 ? cumTP / cumVolume : null);
  }

  return result;
}

export function rsi(data: number[], period: number = 14): (number | null)[] {
  if (data.some((value) => !Number.isFinite(value))) {
    return data.map(() => null);
  }

  const safePeriod = Math.trunc(period);
  if (!Number.isFinite(safePeriod) || safePeriod <= 0) {
    return data.map(() => null);
  }

  const result: (number | null)[] = [];

  if (data.length < safePeriod + 1) {
    return data.map(() => null);
  }

  // Calculate initial average gain/loss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= safePeriod; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= safePeriod;
  avgLoss /= safePeriod;

  // Fill nulls for the initial period
  for (let i = 0; i < safePeriod; i++) {
    result.push(null);
  }

  // First RSI value
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  // Smoothed RSI
  for (let i = safePeriod + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (safePeriod - 1) + gain) / safePeriod;
    avgLoss = (avgLoss * (safePeriod - 1) + loss) / safePeriod;

    const rsVal = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rsVal));
  }

  return result;
}

export function macd(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const safeFastPeriod = Math.trunc(fastPeriod);
  const safeSlowPeriod = Math.trunc(slowPeriod);
  const safeSignalPeriod = Math.trunc(signalPeriod);

  if (
    !Number.isFinite(safeFastPeriod) ||
    !Number.isFinite(safeSlowPeriod) ||
    !Number.isFinite(safeSignalPeriod) ||
    safeFastPeriod <= 0 ||
    safeSlowPeriod <= 0 ||
    safeSignalPeriod <= 0
  ) {
    return {
      macd: data.map(() => null),
      signal: data.map(() => null),
      histogram: data.map(() => null),
    };
  }

  const fastEma = ema(data, safeFastPeriod);
  const slowEma = ema(data, safeSlowPeriod);

  const macdLine: number[] = [];
  const macdWithNulls: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f !== null && s !== null) {
      const val = f - s;
      macdLine.push(val);
      macdWithNulls.push(val);
    } else {
      macdWithNulls.push(null);
    }
  }

  const signalLine = ema(macdLine, safeSignalPeriod);

  // Align signal line with macd line
  const signal: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  let macdIdx = 0;

  for (let i = 0; i < data.length; i++) {
    if (macdWithNulls[i] === null) {
      signal.push(null);
      histogram.push(null);
    } else {
      const sig = signalLine[macdIdx] ?? null;
      signal.push(sig);
      histogram.push(sig !== null ? macdWithNulls[i]! - sig : null);
      macdIdx++;
    }
  }

  return { macd: macdWithNulls, signal, histogram };
}

export function atr(candles: OHLCData[], period: number = 14): (number | null)[] {
  const safePeriod = Math.trunc(period);
  if (!Number.isFinite(safePeriod) || safePeriod <= 0) {
    return candles.map(() => null);
  }

  const trueRanges: number[] = [];
  const result: (number | null)[] = [];

  // Calculate True Range for each candle
  for (let i = 0; i < candles.length; i++) {
    const high = Number(candles[i].high);
    const low = Number(candles[i].low);
    const close = Number(candles[i].close);

    if (![high, low, close].every(Number.isFinite)) {
      trueRanges.push(0);
      continue;
    }

    if (i === 0) {
      trueRanges.push(high - low);
    } else {
      const prevClose = Number(candles[i - 1].close);
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }
  }

  // Not enough data
  if (trueRanges.length < safePeriod) {
    return candles.map(() => null);
  }

  // Initial ATR (simple average)
  let atrValue = trueRanges.slice(0, safePeriod).reduce((a, b) => a + b, 0) / safePeriod;

  // Fill nulls for initial period
  for (let i = 0; i < safePeriod; i++) {
    result.push(null);
  }
  result.push(atrValue);

  // Smoothed ATR using Wilder's method
  for (let i = safePeriod; i < trueRanges.length; i++) {
    atrValue = (atrValue * (safePeriod - 1) + trueRanges[i]) / safePeriod;
    result.push(atrValue);
  }

  return result;
}
