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
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j];
    }
    result.push(sum / period);
  }
  return result;
}

export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[j];
      result.push(sum / period);
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

export function bollingerBands(
  data: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = sma(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    const mid = middle[i];
    if (mid === null || i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }

    let sumSqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSqDiff += (data[j] - mid) ** 2;
    }
    const stdDev = Math.sqrt(sumSqDiff / period);
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
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumVolume += candle.volume;
    cumTP += typicalPrice * candle.volume;
    result.push(cumVolume > 0 ? cumTP / cumVolume : null);
  }

  return result;
}

export function rsi(data: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];

  if (data.length < period + 1) {
    return data.map(() => null);
  }

  // Calculate initial average gain/loss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill nulls for the initial period
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // First RSI value
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  // Smoothed RSI
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

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
  const fastEma = ema(data, fastPeriod);
  const slowEma = ema(data, slowPeriod);

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

  const signalLine = ema(macdLine, signalPeriod);

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
