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
