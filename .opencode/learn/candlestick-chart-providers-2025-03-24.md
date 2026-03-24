# Comprehensive Candlestick Chart Provider Research

**Researched**: March 24, 2026  
**Sources**: TradingView, AG Charts, ChartIQ docs, codebase analysis  
**Current Implementation**: `lightweight-charts v5.1.0` in `components/trading/ChartsTab.tsx`, `CandlestickChart.tsx`, `ResearchChart.tsx`

---

## PART 1: Chart Provider Landscape

### Comparison Matrix

| Provider | Cost | Drawing Tools | Indicators | Multi-Pane | Realtime | Bundle Size | Best For |
|----------|------|--------------|------------|------------|----------|-------------|----------|
| **TradingView Lightweight** | Free | ❌ No | Partial | ✅ v5.0+ | ✅ | ~45KB | Performance-first |
| **TradingView Advanced** | Custom license ($$$) | ✅ Full | ✅ Full | ✅ | ✅ | ~2MB | Full-featured |
| **AG Charts Enterprise** | $750-1500/yr | ✅ Full | ✅ Full | ✅ | ✅ | ~500KB+ | Enterprise |
| **ChartIQ** | Custom quote | ✅ Full | ✅ Full | ✅ | ✅ | ~1MB | Banks/brokers |
| **Apache ECharts** | Free | ✅ Yes | ✅ Via plugins | Manual | ✅ | ~200KB+ | Open source |
| **CanvasJS** | $199-3999 | ✅ Yes | ✅ Yes | ❌ | ✅ | ~500KB | Simple charts |

### Provider Deep Dive

#### 1. TradingView Lightweight Charts (CURRENT - v5.1.0)
**What you're using now**

**Features**:
- 45KB gzipped, fastest render times
- Candlestick, OHLC, Line, Area, Baseline, Histogram
- Native multi-pane support (v5.0+)
- Plugin system (custom series, primitives)
- Crosshair, price scale, time scale
- Realtime data updates
- Screenshot export

**Limitations**:
- NO built-in drawing tools (trendlines, fibonacci)
- NO built-in indicator library (SMA/EMA/VWAP/Bollinger must be computed externally)
- NO pattern recognition
- NO native annotations

**Price**: Free (Apache 2.0)

**Code Example - Your Current Implementation**:
```typescript
// From CandlestickChart.tsx - lifecycle pattern
const { chart, candleSeries, volumeSeries, cleanup } = createChartLifecycle({
  container: containerRef.current,
  height: 400,
  showTimeAxis: true,
  onResize: (width) => {
    setContainerWidth(width);
  },
});

// External indicator calculation (lib/indicators.ts)
const emaValues = ema(closePrices, 21);
const series = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1 });
```

#### 2. TradingView Advanced Charts
**The "pro" widget used on tradingview.com**

**Features**:
- 100+ built-in indicators (Ichimoku, Parabolic SAR, ATR, etc.)
- Full drawing toolbar (trendlines, channels, fibonacci, patterns)
- Saved chart layouts
- Social features (shared ideas, chat)
- Real-time price alerts
- Native pattern recognition
- Pine Script support

**Limitations**:
- Requires TradingView licensing (expensive, ~$5K-50K+/year)
- Heavy bundle (~2MB)
- Hosted/iframe solution (data passes through their servers)
- Minimum volume requirements

**Price**: Custom enterprise pricing

#### 3. AG Charts (AG Grid)
**Enterprise-grade alternative**

**Features**:
- Native annotations toolbar (trendlines, shapes)
- Built-in financial toolbar
- Range buttons for time navigation
- Zoom and pan
- Navigator
- Real-time updates
- React/Angular/Vue first-class support

**Price**: 
- Community: Free
- Enterprise: $750/yr (developer) to $1500/yr (includes AG Grid)

**Code Example**:
```typescript
import { AgFinancialCharts } from 'ag-charts-react';

// Minimal configuration - annotations included!
const options = {
  data: candleData, // { date, open, high, low, close, volume }
  annotations: {
    enabled: true,
    toolbar: {
      buttons: ['trend-line', 'parallel-channel', 'fibonacci-retracement'],
    },
  },
};

<AgFinancialCharts options={options} />
```

#### 4. ChartIQ
**Institutional-grade from Cosaic**

**Features**:
- Most mature drawing tools
- Stxx.Drawing for custom tools
- Built-in 300+ indicators
- Multi-chart layout
- Cross-chart synchronization
- Streaming data optimized

**Limitations**:
- Expensive (institutional pricing)
- Complex API
- Heavy bundle

**Price**: Enterprise custom quote

#### 5. Apache ECharts (Apache)
**Free open-source alternative**

**Features**:
- 20+ chart types
- Canvas/WebGL rendering
- DataZoom for large datasets
- Built-in indicators (SMA, EMA, RSI, etc.)
- MarkLine/MarkPoint for annotations
- Free

**Limitations**:
- Drawing tools require manual implementation
- Not financial-focused by default
- Need custom plugins for pro features

**Code Example**:
```typescript
import * as echarts from 'echarts';

const option = {
  xAxis: { type: 'category', data: dates },
  yAxis: { type: 'value' },
  series: [{
    type: 'candlestick',
    data: candleData,
    markLine: {
      // Manual trendline
      data: [{ yAxis: 100 }, { yAxis: 200 }]
    }
  }]
};
```

---

## PART 2: Enhancement Strategies for lightweight-charts

Your current setup is solid. Here's how to add "pro" features without switching libraries.

### What You Already Have (Good Foundation)
- ✅ Multi-series (price + volume + comparison)
- ✅ Custom indicators (SMA, EMA, VWAP, Bollinger)
- ✅ Session shading (pre/post market)
- ✅ Crosshair with OHLC legend
- ✅ Trade markers (entry/exit arrows)
- ✅ Screenshot export
- ✅ Multiple series types (candles, bars, line, area, baseline)
- ✅ Timeframe switching
- ✅ Magnet mode
- ✅ Grid toggle
- ✅ Symbol comparison (beta)

### What's Missing (vs TradingView Pro)

| Feature | Status | Effort | How to Add |
|---------|--------|--------|------------|
| Drawing Tools | ❌ | High | Custom canvas plugin |
| Ichimoku Cloud | ❌ | Low | Add to lib/indicators.ts |
| Parabolic SAR | ❌ | Low | Add to lib/indicators.ts |
| ATR | ❌ | Low | Add to lib/indicators.ts |
| Multi-pane indicators | ✅ | Done | v5.0 native |
| Pattern Recognition | ❌ | High | External library |
| Fibonacci Retracement | ❌ | High | Custom plugin |
| Trendline Persistence | ❌ | Med | State management |
| Alert Lines | ❌ | Low | Price lines + events |

### Quick Wins (1-2 days)

#### 1. Add More Indicators
**File**: `lib/indicators.ts`

```typescript
// Add to existing indicators.ts
export function parabolicSAR(highs: number[], lows: number[], step: number = 0.02, max: number = 0.2): number[] {
  const sar: number[] = [];
  let isLong = true;
  let af = step;
  let ep = highs[0];
  let sarValue = lows[0];

  for (let i = 1; i < highs.length; i++) {
    sarValue = sarValue + af * (ep - sarValue);
    
    if (isLong) {
      if (lows[i] < sarValue) {
        isLong = false;
        sarValue = Math.max(highs[i - 1], highs[i - 2]);
        af = step;
        ep = lows[i];
      } else {
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + step, max);
        }
      }
    } else {
      if (highs[i] > sarValue) {
        isLong = true;
        sarValue = Math.min(lows[i - 1], lows[i - 2]);
        af = step;
        ep = highs[i];
      } else {
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + step, max);
        }
      }
    }
    sar.push(sarValue);
  }
  return sar;
}

export function averageTrueRange(candles: CandleData[], period: number = 14): number[] {
  const tr: number[] = [];
  const atr: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
    } else {
      const tr1 = candles[i].high - candles[i].low;
      const tr2 = Math.abs(candles[i].high - candles[i - 1].close);
      const tr3 = Math.abs(candles[i].low - candles[i - 1].close);
      tr.push(Math.max(tr1, tr2, tr3));
    }
  }

  // Wilder's smoothing
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      atr.push(null as any);
    } else if (i === period) {
      atr.push(tr.slice(0, period).reduce((a, b) => a + b, 0) / period);
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
    }
  }

  return atr;
}
```

#### 2. Alert Price Lines
**File**: `components/trading/CandlestickChart.tsx`

You already have `priceLines` prop - add sound/notification:

```typescript
// Add to CandlestickChart.tsx
useEffect(() => {
  if (!priceLines || priceLines.length === 0) return;
  
  const latestPrice = sortedCandles[sortedCandles.length - 1]?.close;
  if (!latestPrice) return;
  
  priceLines.forEach(line => {
    if (Math.abs(latestPrice - line.price) < 0.01) {
      // Trigger alert
      new Audio('/alert-sound.mp3').play().catch(() => {});
    }
  });
}, [candles, priceLines]);
```

#### 3. Performance Optimization
**For large datasets**:

```typescript
// Add data decimation for >1000 candles
function decimateData(candles: CandleData[], maxPoints: number = 1000): CandleData[] {
  if (candles.length <= maxPoints) return candles;
  
  const ratio = Math.ceil(candles.length / maxPoints);
  return candles.filter((_, i) => i % ratio === 0);
}
```

### Medium Effort (1-2 weeks)

#### 1. Drawing Tools (Trendlines)
**Requires**: Custom primitive plugin

```typescript
// components/trading/plugins/TrendLinePrimitive.ts
import { ISeriesPrimitive, SeriesAttachedParameter } from 'lightweight-charts';

export class TrendLinePrimitive implements ISeriesPrimitive {
  private _p1: { time: number; price: number } | null = null;
  private _p2: { time: number; price: number } | null = null;

  applyOptions(p1: { time: number; price: number }, p2: { time: number; price: number }) {
    this._p1 = p1;
    this._p2 = p2;
    this.requestUpdate();
  }

  draw({ context, priceToCoordinate, timeScale }: SeriesAttachedParameter) {
    if (!this._p1 || !this._p2) return;
    
    const y1 = priceToCoordinate(this._p1.price);
    const y2 = priceToCoordinate(this._p2.price);
    const x1 = timeScale.timeToCoordinate(this._p1.time as Time);
    const x2 = timeScale.timeToCoordinate(this._p2.time as Time);
    
    if (y1 === null || y2 === null || x1 === null || x2 === null) return;
    
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.strokeStyle = '#f59e0b';
    context.lineWidth = 2;
    context.stroke();
  }
}

// Usage in component:
const trendLine = new TrendLinePrimitive();
candleSeries.attachPrimitive(trendLine);
trendLine.applyOptions(
  { time: candles[0].datetime / 1000, price: candles[0].close },
  { time: candles[candles.length - 1].datetime / 1000, price: candles[candles.length - 1].close }
);
```

#### 2. Separate Indicator Panes
**Lightweight Charts v5.0+ supports this natively**:

```typescript
// From ChartsTab.tsx - you're already doing this
const chart = createChart(container, {
  // ...options
});

// Price pane
const candleSeries = chart.addSeries(CandlestickSeries, { ... });

// Volume on separate scale (already implemented)
const volumeSeries = chart.addSeries(HistogramSeries, {
  priceScaleId: 'volume',
});
chart.priceScale('volume').applyOptions({
  scaleMargins: { top: 0.8, bottom: 0 },
});

// For a full indicator pane (RSI, MACD, etc.):
const rsiPane = chart.addPane({
  height: 100,
  stretchFactor: 0.3,
});
const rsiSeries = rsiPane.addSeries(LineSeries, {
  color: '#8b5cf6',
});
```

#### 3. Chart Persistence
Save/load chart state to localStorage:

```typescript
// lib/chart-persistence.ts
export interface ChartState {
  timeframe: TimeframeKey;
  seriesType: SeriesType;
  indicators: { sma: boolean; ema: boolean; vwap: boolean; bollinger: boolean };
  drawings: Array<{ type: 'trendline'; p1: Point; p2: Point }>;
  zoom: { from: number; to: number };
}

export function saveChartState(symbol: string, state: ChartState) {
  localStorage.setItem(`chart-state-${symbol}`, JSON.stringify(state));
}

export function loadChartState(symbol: string): ChartState | null {
  const saved = localStorage.getItem(`chart-state-${symbol}`);
  return saved ? JSON.parse(saved) : null;
}
```

### Heavy Lifts (Month+)

#### 1. Full Drawing Toolbar
**Requires**: Mouse event handling, hit detection, undo/redo stack

Architecture:
```typescript
// components/trading/DrawingToolbar.tsx
const tools = [
  { id: 'trendline', icon: LineIcon, cursor: 'crosshair' },
  { id: 'fibonacci', icon: FibIcon, cursor: 'crosshair' },
  { id: 'rectangle', icon: RectIcon, cursor: 'crosshair' },
  { id: 'text', icon: TextIcon, cursor: 'text' },
];

// Event handling in chart component
const handleChartClick = (param: MouseEventParams) => {
  if (activeTool === 'trendline') {
    if (!drawingStart) {
      setDrawingStart(param.time);
    } else {
      finalizeTrendLine(drawingStart, param.time);
    }
  }
};
```

#### 2. Pattern Recognition
**Requires**: External library like `technicalindicators` + ML

```typescript
// Pattern detection using technicalindicators npm package
import { detectPatterns } from 'technicalindicators';

const patterns = detectPatterns({
  candles: data,
  patternTypes: ['doji', 'hammer', 'engulfing'],
});

// Render markers
patterns.forEach(pattern => {
  markers.push({
    time: pattern.time,
    position: 'aboveBar',
    color: pattern.bullish ? '#22c55e' : '#ef4444',
    shape: pattern.name === 'doji' ? 'circle' : 'arrowDown',
    text: pattern.name,
  });
});
```

---

## PART 3: TradingView Pro Feature Analysis

### What Makes TradingView "Pro"

| Feature | Can You Replicate? | Difficulty | Notes |
|---------|-------------------|------------|-------|
| 100+ Built-in Indicators | ⚠️ Partial | Medium | Add top 20 to lib/indicators.ts |
| Drawing Toolbar | ✅ Yes | High | Custom plugins (see above) |
| Saved Layouts | ✅ Yes | Low | localStorage/DB |
| Pine Script | ❌ No | N/A | Requires their infrastructure |
| Real-time WebSocket | ✅ Yes | Medium | Already have use-market-stream.ts |
| Multi-timeframe Sync | ✅ Yes | Medium | React state management |
| Social/Shared Ideas | ❌ No | N/A | Would need social backend |
| Screeners/Scanning | ⚠️ Partial | Medium | Can build with your data |
| DOM/Level 2 | ✅ Yes | High | Requires exchange integration |
| Backtesting | ✅ Yes | High | Can build locally |

### Technical Gap Analysis

**What lightweight-charts CAN'T do** (fundamental limitations):
1. **Pine Script** - Requires TradingView's proprietary execution engine
2. **Server-side calculations** - TradingView computes indicators on their servers
3. **Historical data beyond your feed** - Limited by your data provider

**What you CAN build** with effort:
1. **Full drawing suite** - ~2-3 weeks of work
2. **Complete indicator library** - ~1 week (math is documented)
3. **Chart templates** - ~1 week
4. **Cross-chart sync** - ~1 week
5. **Alert system** - ~1 week

---

## PART 4: Implementation Recommendations

### Option 1: Stay with lightweight-charts (RECOMMENDED for you)

**Why this fits Nexus Terminal**:
- ✅ You already have working implementation
- ✅ Free (important for personal use)
- ✅ 45KB bundle size (fast loading)
- ✅ Your current setup handles 90% of needs
- ✅ React/Next.js works well with it
- ✅ Can add features incrementally

**Roadmap**:

**Week 1: Quick Wins**
1. Add 5 more indicators to `lib/indicators.ts` (Parabolic SAR, Ichimoku, ATR, RSI, MACD)
2. Add alert sound when price crosses levels
3. Decimate data for performance on 1m charts

**Week 2-3: Drawing Tools**
1. Implement basic trendline primitive
2. Add rectangle drawing
3. Persist drawings to localStorage

**Week 4: Polish**
1. Chart state persistence (zoom, indicators, drawings per symbol)
2. Multiple timeframes sync
3. Screenshot improvements

**Total cost**: $0, ~4 weeks of development

### Option 2: AG Charts Enterprise

**When to switch**:
- You need drawing tools NOW, not in 4 weeks
- Budget allows $750-1500/yr
- Want annotation toolbar out of the box
- Don't want to maintain custom drawing code

**Migration effort**: ~2 weeks (different API, but similar concepts)

### Option 3: TradingView Advanced Charts

**When to switch**:
- You're building a commercial product
- Budget is $10K+/year
- Need TradingView brand recognition
- Don't mind data passing through their servers

**This is NOT recommended** for Nexus Terminal - overkill for personal use.

### My Recommendation

**Stay with lightweight-charts and enhance it**. Here's why:

1. **Your current setup is good** - You've built a solid foundation with:
   - Proper lifecycle management (`createChartLifecycle`)
   - External indicators working
   - Session shading
   - Trade markers
   - Multiple timeframes

2. **Missing features are addable** - Drawing tools, more indicators, and pattern recognition can be built incrementally

3. **Cost-effective** - $0 vs $750+/year

4. **Learning opportunity** - Building drawing tools teaches you canvas rendering, which is valuable

5. **You own the code** - No vendor lock-in, no licensing headaches

### Immediate Next Steps

1. **Add 3 high-value indicators** (1 day):
   - Parabolic SAR (trend following)
   - ATR (volatility measurement)
   - MACD (momentum)

2. **Implement basic trendline** (3-5 days):
   - Create TrendLinePrimitive
   - Add mouse event handlers
   - Persist to state

3. **Pattern recognition** (2-3 days):
   - Install `technicalindicators` package
   - Detect doji, hammer, engulfing
   - Add markers

### Code to Add Tomorrow

```typescript
// lib/indicators.ts - Add these

export function rsi(prices: number[], period: number = 14): (number | null)[] {
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  const result: (number | null)[] = new Array(period).fill(null);
  
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;
  
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
    const rs = avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }
  
  return result;
}

export function macd(
  prices: number[], 
  fast: number = 12, 
  slow: number = 26, 
  signal: number = 9
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = ema(prices, fast);
  const emaSlow = ema(prices, slow);
  
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (emaFast[i] == null || emaSlow[i] == null) {
      macdLine.push(null);
    } else {
      macdLine.push((emaFast[i] as number) - (emaSlow[i] as number));
    }
  }
  
  const validMacd = macdLine.filter((x): x is number => x !== null);
  const signalLine = ema(validMacd, signal);
  const paddedSignal = [...new Array(macdLine.length - validMacd.length).fill(null), ...signalLine];
  
  const histogram: (number | null)[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null || paddedSignal[i] === null) {
      histogram.push(null);
    } else {
      histogram.push((macdLine[i] as number) - (paddedSignal[i] as number));
    }
  }
  
  return { macd: macdLine, signal: paddedSignal, histogram };
}
```

---

## Codebase Evidence

Your implementation is well-structured:

- `components/trading/ChartsTab.tsx:482` - Proper lifecycle management with ResizeObserver
- `components/trading/CandlestickChart.tsx:183` - `createChartLifecycle` helper is good pattern
- `lib/indicators.ts` - External indicator calculations (SMA, EMA, VWAP, Bollinger)
- `hooks/use-candle-data.ts` - Data fetching abstraction

Current indicators in `lib/indicators.ts`:
- SMA ✓
- EMA ✓
- VWAP ✓
- Bollinger Bands ✓

Missing but addable:
- RSI
- MACD
- Parabolic SAR
- ATR
- Ichimoku Cloud
- Stochastic
- Williams %R

---

## Known Unknowns

- **TradingView Advanced pricing**: No public pricing, requires contact sales
- **ChartIQ pricing**: No public pricing, likely $5K-20K+/year
- **AG Charts free tier limitations**: Some financial features may require Enterprise

---

## Summary

**You don't need to switch chart providers**. lightweight-charts v5.1.0 is capable of everything you need for a personal trading platform. The missing "pro" features (drawing tools, more indicators) can be added incrementally with 2-4 weeks of development.

**Skip TradingView Advanced** - too expensive, requires their infrastructure.
**Consider AG Charts** only if you need annotations immediately and don't mind paying $750-1500/year.

**Recommended path**: Enhance lightweight-charts with custom indicators and a basic drawing toolbar. This teaches you how canvas rendering works and gives you full control.
