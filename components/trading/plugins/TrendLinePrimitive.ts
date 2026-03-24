// Simple trendline using canvas overlay approach
// This avoids the complex ISeriesPrimitive type issues

export interface TrendLineOptions {
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
  color?: string;
  lineWidth?: number;
}

export interface TrendLineRenderer {
  draw(
    context: CanvasRenderingContext2D,
    priceToCoordinate: (price: number) => number | null,
    timeToCoordinate: (time: number) => number | null
  ): void;
}

export function createTrendLineRenderer(options: TrendLineOptions): TrendLineRenderer {
  const { startTime, startPrice, endTime, endPrice, color = '#f59e0b', lineWidth = 2 } = options;

  return {
    draw(context, priceToCoordinate, timeToCoordinate) {
      const y1 = priceToCoordinate(startPrice);
      const y2 = priceToCoordinate(endPrice);
      const x1 = timeToCoordinate(startTime);
      const x2 = timeToCoordinate(endTime);

      if (y1 === null || y2 === null || x1 === null || x2 === null) return;

      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.setLineDash([]);
      context.stroke();

      // Draw endpoints
      const endpointRadius = 4;
      context.beginPath();
      context.arc(x1, y1, endpointRadius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();

      context.beginPath();
      context.arc(x2, y2, endpointRadius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    },
  };
}
