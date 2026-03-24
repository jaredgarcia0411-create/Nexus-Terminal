export interface RectangleOptions {
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
  color?: string;
  lineWidth?: number;
  fillColor?: string;
}

export interface RectangleRenderer {
  draw(
    context: CanvasRenderingContext2D,
    priceToCoordinate: (price: number) => number | null,
    timeToCoordinate: (time: number) => number | null
  ): void;
}

export function createRectangleRenderer(options: RectangleOptions): RectangleRenderer {
  const {
    startTime,
    startPrice,
    endTime,
    endPrice,
    color = '#3b82f6',
    lineWidth = 2,
    fillColor = 'rgba(59, 130, 246, 0.1)',
  } = options;

  return {
    draw(context, priceToCoordinate, timeToCoordinate) {
      const y1 = priceToCoordinate(startPrice);
      const y2 = priceToCoordinate(endPrice);
      const x1 = timeToCoordinate(startTime);
      const x2 = timeToCoordinate(endTime);

      if (y1 === null || y2 === null || x1 === null || x2 === null) return;

      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);

      // Fill
      if (fillColor) {
        context.fillStyle = fillColor;
        context.fillRect(left, top, right - left, bottom - top);
      }

      // Border
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.setLineDash([]);
      context.strokeRect(left, top, right - left, bottom - top);

      // Draw corner handles
      const handleSize = 6;
      context.fillStyle = color;

      // Top-left
      context.fillRect(left - handleSize / 2, top - handleSize / 2, handleSize, handleSize);
      // Top-right
      context.fillRect(right - handleSize / 2, top - handleSize / 2, handleSize, handleSize);
      // Bottom-left
      context.fillRect(left - handleSize / 2, bottom - handleSize / 2, handleSize, handleSize);
      // Bottom-right
      context.fillRect(right - handleSize / 2, bottom - handleSize / 2, handleSize, handleSize);
    },
  };
}
