// Fibonacci retracement renderer drawn on the same canvas overlay as the
// other drawing primitives. Levels are stored as decimals (0–1); each level
// becomes a horizontal line between the two anchor x-coordinates with a
// "<pct>% | $<price>" label on the right edge.

export interface FibonacciOptions {
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
  levels?: number[];
  color?: string;
  lineWidth?: number;
  showLabels?: boolean;
}

export interface FibonacciRenderer {
  draw(
    context: CanvasRenderingContext2D,
    priceToCoordinate: (price: number) => number | null,
    timeToCoordinate: (time: number) => number | null
  ): void;
}

// User-requested defaults (percentages → decimals).
export const DEFAULT_FIBONACCI_LEVELS = [0.07, 0.15, 0.25, 0.30, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00];

export function createFibonacciRenderer(options: FibonacciOptions): FibonacciRenderer {
  const {
    startTime,
    startPrice,
    endTime,
    endPrice,
    levels = DEFAULT_FIBONACCI_LEVELS,
    color = '#a855f7',
    lineWidth = 1,
    showLabels = true,
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
      const topPrice = Math.max(startPrice, endPrice);
      const bottomPrice = Math.min(startPrice, endPrice);
      const priceRange = topPrice - bottomPrice;

      // Anchor diagonal connecting the two endpoints.
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.setLineDash([5, 5]);
      context.stroke();
      context.setLineDash([]);

      // Each retracement level as a horizontal line + label.
      levels.forEach((level) => {
        const levelPrice = topPrice - priceRange * level;
        const y = priceToCoordinate(levelPrice);
        if (y === null) return;

        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(right, y);
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.setLineDash([2, 2]);
        context.stroke();
        context.setLineDash([]);

        if (showLabels) {
          const pctLabel = `${(level * 100).toFixed(0)}%`;
          const priceLabel = `$${levelPrice.toFixed(2)}`;
          context.font = '11px sans-serif';
          context.fillStyle = color;
          context.textAlign = 'right';
          context.textBaseline = 'middle';
          context.fillText(`${pctLabel} | ${priceLabel}`, left - 8, y);
        }
      });

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
