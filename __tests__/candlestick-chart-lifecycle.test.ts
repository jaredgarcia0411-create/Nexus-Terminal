import { describe, expect, it, vi } from 'vitest';

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(),
  createSeriesMarkers: vi.fn(),
  ColorType: { Solid: 'solid' },
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  CrosshairMode: { Normal: 'normal' },
}));

function createChartMock() {
  const volumeScaleApplyOptions = vi.fn();
  const chart = {
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    priceScale: vi.fn(() => ({ applyOptions: volumeScaleApplyOptions })),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };

  return { chart, volumeScaleApplyOptions };
}

describe('createChartLifecycle', () => {
  it('disposes chart and disconnects observer on cleanup', async () => {
    const { createChartLifecycle } = await import('@/components/trading/CandlestickChart');
    const { chart } = createChartMock();
    const createChartFn = vi.fn(() => chart as any);

    const observe = vi.fn();
    const disconnect = vi.fn();
    class MockResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe = observe;
      disconnect = disconnect;
    }

    const containerState = { clientWidth: 640 };
    const container = containerState as unknown as HTMLDivElement;
    const lifecycle = createChartLifecycle({
      container,
      height: 320,
      createChartFn: createChartFn as any,
      resizeObserverCtor: MockResizeObserver as any,
    });

    expect(observe).toHaveBeenCalledWith(container);

    lifecycle.cleanup();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(chart.remove).toHaveBeenCalledTimes(1);
  });

  it('applies width updates from resize observer callback', async () => {
    const { createChartLifecycle } = await import('@/components/trading/CandlestickChart');
    const { chart } = createChartMock();
    const createChartFn = vi.fn(() => chart as any);

    type ResizeCallback = (entries: unknown[], observer: unknown) => void;
    let resizeCallback: ResizeCallback | null = null;
    class MockResizeObserver {
      constructor(callback: ResizeCallback) {
        resizeCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }

    const containerState = { clientWidth: 500 };
    const container = containerState as unknown as HTMLDivElement;
    const lifecycle = createChartLifecycle({
      container,
      height: 300,
      createChartFn: createChartFn as any,
      resizeObserverCtor: MockResizeObserver as any,
    });

    const triggerResize = () => {
      expect(resizeCallback).not.toBeNull();
      (resizeCallback as ResizeCallback)([], {});
    };

    containerState.clientWidth = 720;
    triggerResize();

    expect(chart.applyOptions).toHaveBeenCalledWith({ width: 720 });

    containerState.clientWidth = 0;
    triggerResize();
    expect(chart.applyOptions).toHaveBeenCalledTimes(1);

    lifecycle.cleanup();
  });

  it('configures volume panel scale margins', async () => {
    const { createChartLifecycle } = await import('@/components/trading/CandlestickChart');
    const { chart, volumeScaleApplyOptions } = createChartMock();
    const createChartFn = vi.fn(() => chart as any);

    const containerState = { clientWidth: 700 };
    const container = containerState as unknown as HTMLDivElement;
    const lifecycle = createChartLifecycle({
      container,
      height: 400,
      createChartFn: createChartFn as any,
      resizeObserverCtor: undefined,
    });

    expect(chart.priceScale).toHaveBeenCalledWith('volume');
    expect(volumeScaleApplyOptions).toHaveBeenCalledWith({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    lifecycle.cleanup();
  });
});
