import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';

export interface TriangleMarker {
  time: Time;
  price: number;
  direction: 'LONG' | 'SHORT';
}

type PaneRenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

const LONG_FILL = '#22c55e';
const SHORT_FILL = '#ef4444';
const BORDER = '#000000';
const HALF_WIDTH = 6;
const HEIGHT = 10;

class TriangleMarkersPaneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly source: TriangleMarkersPrimitive,
    private readonly gap: number,
  ) {}

  draw(target: PaneRenderTarget): void {
    const chart = this.source.chart;
    const series = this.source.series;
    if (!chart || !series) return;

    const timeScale = chart.timeScale();

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;

      for (const marker of this.source.markers) {
        const xMedia = timeScale.timeToCoordinate(marker.time);
        const yMedia = series.priceToCoordinate(marker.price);
        if (xMedia === null || yMedia === null) continue;

        const x = xMedia * hpr;
        const y = yMedia * vpr;
        const hw = HALF_WIDTH * hpr;
        const h = HEIGHT * vpr;
        const gap = this.gap * vpr;

        ctx.beginPath();
        if (marker.direction === 'LONG') {
          const tipY = y + gap;
          ctx.moveTo(x, tipY);
          ctx.lineTo(x - hw, tipY + h);
          ctx.lineTo(x + hw, tipY + h);
        } else {
          const tipY = y - gap;
          ctx.moveTo(x, tipY);
          ctx.lineTo(x - hw, tipY - h);
          ctx.lineTo(x + hw, tipY - h);
        }
        ctx.closePath();
        ctx.fillStyle = marker.direction === 'LONG' ? LONG_FILL : SHORT_FILL;
        ctx.fill();
        ctx.lineWidth = Math.max(1, Math.round(1.25 * hpr));
        ctx.strokeStyle = BORDER;
        ctx.stroke();
      }
    });
  }
}

class TriangleMarkersPaneView implements IPrimitivePaneView {
  constructor(
    private readonly source: TriangleMarkersPrimitive,
    private readonly gap: number,
  ) {}

  renderer(): IPrimitivePaneRenderer {
    return new TriangleMarkersPaneRenderer(this.source, this.gap);
  }
}

export class TriangleMarkersPrimitive implements ISeriesPrimitive<Time> {
  markers: TriangleMarker[] = [];
  chart: IChartApiBase<Time> | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate?: () => void;
  private readonly paneView: TriangleMarkersPaneView;

  constructor(gap = 4) {
    this.paneView = new TriangleMarkersPaneView(this, gap);
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  setMarkers(markers: TriangleMarker[]): void {
    this.markers = markers;
    this.requestUpdate?.();
  }

  updateAllViews(): void {}

  paneViews(): IPrimitivePaneView[] {
    return [this.paneView];
  }
}
