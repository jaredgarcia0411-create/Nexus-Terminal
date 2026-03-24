// Horizontal line renderer - uses createPriceLine API
export interface HorizontalLineOptions {
  price: number;
  color?: string;
  lineWidth?: number;
  title?: string;
}

// This is handled via series.createPriceLine() in the main component
// This file exists for type consistency
export type HorizontalLineRenderer = null;
