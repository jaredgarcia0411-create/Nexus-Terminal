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

// Default Fibonacci levels
export const DEFAULT_FIBONACCI_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

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

      // Draw base line
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.setLineDash([5, 5]);
      context.stroke();
      context.setLineDash([]);

      // Draw fibonacci levels
      levels.forEach((level) => {
        const levelPrice = topPrice - priceRange * level;
        const y = priceToCoordinate(levelPrice);

        if (y === null) return;

        // Draw horizontal line
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(right, y);
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.setLineDash([2, 2]);
        context.stroke();
        context.setLineDash([]);

    // Draw label with price on the left side
    if (showLabels) {
      const pctLabel = `${(level * 100).toFixed(1)}%`;
      const priceLabel = `$${levelPrice.toFixed(2)}`;
      const label = `${priceLabel} | ${pctLabel}`;
      context.font = '11px sans-serif';
      context.fillStyle = color;
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.fillText(label, left - 5, y);
    }
      });

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

// Calculate fibonacci price levels
export function calculateFibonacciLevels(
  startPrice: number,
  endPrice: number,
  levels: number[] = DEFAULT_FIBONACCI_LEVELS
): Array<{ level: number; price: number }> {
  const high = Math.max(startPrice, endPrice);
  const low = Math.min(startPrice, endPrice);
  const range = high - low;

  return levels.map((level) => ({
    level,
    price: high - range * level,
  }));
}
