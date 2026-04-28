import type { BacktestAction } from '@/lib/types';

export type SimDirection = 'LONG' | 'SHORT' | 'FLAT';

export interface SimPosition {
  direction: SimDirection;
  totalShares: number;
  avgEntry: number | null;
  stop: number | null;
  realizedPnl: number;
  lastExitPrice: number | null;
  initialRiskDollars: number;
  closedShares: number;
  totalSharesEverOpened: number;
}

function createEmptyPosition(riskDollars: number): SimPosition {
  return {
    direction: 'FLAT',
    totalShares: 0,
    avgEntry: null,
    stop: null,
    realizedPnl: 0,
    lastExitPrice: null,
    initialRiskDollars: riskDollars,
    closedShares: 0,
    totalSharesEverOpened: 0,
  };
}

function floorWholeShares(rawShares: number) {
  if (!Number.isFinite(rawShares)) {
    throw new Error('Share calculation failed');
  }

  const shares = Math.floor(rawShares);
  if (shares < 1) {
    throw new Error('Risk is too small to size at least one share');
  }

  return shares;
}

export function sizeForOpen(
  riskDollars: number,
  entryPrice: number,
  stopPrice: number,
  direction: 'LONG' | 'SHORT',
) {
  if (!Number.isFinite(riskDollars) || riskDollars <= 0) {
    throw new Error('Risk dollars must be positive');
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(stopPrice) || stopPrice <= 0) {
    throw new Error('Entry and stop must be positive');
  }

  if (direction === 'LONG' && stopPrice >= entryPrice) {
    throw new Error('LONG stop must be below entry');
  }
  if (direction === 'SHORT' && stopPrice <= entryPrice) {
    throw new Error('SHORT stop must be above entry');
  }

  const perShareRisk = Math.abs(entryPrice - stopPrice);
  if (perShareRisk <= 0) {
    throw new Error('Per-share risk must be positive');
  }

  return { shares: floorWholeShares(riskDollars / perShareRisk) };
}

export function sizeForAdd(
  position: SimPosition,
  newStopPrice: number,
  clickPrice: number,
): { shares: number; resultingAvgEntry: number; resultingTotalRisk: number } {
  if (position.direction === 'FLAT' || position.avgEntry == null || position.totalShares < 1) {
    throw new Error('Cannot add while flat');
  }
  if (!Number.isFinite(newStopPrice) || newStopPrice <= 0 || !Number.isFinite(clickPrice) || clickPrice <= 0) {
    throw new Error('Prices must be positive');
  }

  let rawShares: number;
  if (position.direction === 'LONG') {
    if (newStopPrice >= clickPrice) {
      throw new Error('LONG add stop must be below entry');
    }
    rawShares = (
      position.initialRiskDollars
      - position.totalShares * (position.avgEntry - newStopPrice)
    ) / (clickPrice - newStopPrice);
  } else {
    if (newStopPrice <= clickPrice) {
      throw new Error('SHORT add stop must be above entry');
    }
    rawShares = (
      position.initialRiskDollars
      - position.totalShares * (newStopPrice - position.avgEntry)
    ) / (newStopPrice - clickPrice);
  }

  const shares = floorWholeShares(rawShares);
  const nextTotalShares = position.totalShares + shares;
  const resultingAvgEntry = (
    position.totalShares * position.avgEntry
    + shares * clickPrice
  ) / nextTotalShares;
  const resultingTotalRisk = position.direction === 'LONG'
    ? nextTotalShares * (resultingAvgEntry - newStopPrice)
    : nextTotalShares * (newStopPrice - resultingAvgEntry);

  return { shares, resultingAvgEntry, resultingTotalRisk };
}

export function reduceActions(actions: BacktestAction[], riskDollars: number): SimPosition {
  const position = createEmptyPosition(riskDollars);

  for (const action of actions) {
    switch (action.actionType) {
      case 'LONG': {
        if (position.direction !== 'FLAT') {
          throw new Error('LONG is only valid from FLAT');
        }
        if (action.stopPrice == null) {
          throw new Error('LONG requires a stop price');
        }
        position.direction = 'LONG';
        position.totalShares = action.shares;
        position.avgEntry = action.price;
        position.stop = action.stopPrice;
        position.totalSharesEverOpened += action.shares;
        break;
      }
      case 'SHORT': {
        if (position.direction !== 'FLAT') {
          throw new Error('SHORT is only valid from FLAT');
        }
        if (action.stopPrice == null) {
          throw new Error('SHORT requires a stop price');
        }
        position.direction = 'SHORT';
        position.totalShares = action.shares;
        position.avgEntry = action.price;
        position.stop = action.stopPrice;
        position.totalSharesEverOpened += action.shares;
        break;
      }
      case 'LONG_ADD': {
        if (position.direction !== 'LONG' || position.avgEntry == null) {
          throw new Error('LONG_ADD is only valid from LONG');
        }
        if (action.stopPrice == null) {
          throw new Error('LONG_ADD requires a stop price');
        }
        position.avgEntry = (
          position.totalShares * position.avgEntry
          + action.shares * action.price
        ) / (position.totalShares + action.shares);
        position.totalShares += action.shares;
        position.stop = action.stopPrice;
        position.totalSharesEverOpened += action.shares;
        break;
      }
      case 'SHORT_ADD': {
        if (position.direction !== 'SHORT' || position.avgEntry == null) {
          throw new Error('SHORT_ADD is only valid from SHORT');
        }
        if (action.stopPrice == null) {
          throw new Error('SHORT_ADD requires a stop price');
        }
        position.avgEntry = (
          position.totalShares * position.avgEntry
          + action.shares * action.price
        ) / (position.totalShares + action.shares);
        position.totalShares += action.shares;
        position.stop = action.stopPrice;
        position.totalSharesEverOpened += action.shares;
        break;
      }
      case 'SELL': {
        if (position.direction !== 'LONG' || position.avgEntry == null) {
          throw new Error('SELL is only valid from LONG');
        }
        if (action.shares > position.totalShares) {
          throw new Error('SELL cannot exceed open shares');
        }
        position.realizedPnl += (action.price - position.avgEntry) * action.shares;
        position.totalShares -= action.shares;
        position.closedShares += action.shares;
        position.lastExitPrice = action.price;
        if (position.totalShares === 0) {
          position.direction = 'FLAT';
          position.avgEntry = null;
          position.stop = null;
        }
        break;
      }
      case 'COVER': {
        if (position.direction !== 'SHORT' || position.avgEntry == null) {
          throw new Error('COVER is only valid from SHORT');
        }
        if (action.shares > position.totalShares) {
          throw new Error('COVER cannot exceed open shares');
        }
        position.realizedPnl += (position.avgEntry - action.price) * action.shares;
        position.totalShares -= action.shares;
        position.closedShares += action.shares;
        position.lastExitPrice = action.price;
        if (position.totalShares === 0) {
          position.direction = 'FLAT';
          position.avgEntry = null;
          position.stop = null;
        }
        break;
      }
      default: {
        const exhaustiveCheck: never = action.actionType;
        throw new Error(`Unsupported action type: ${exhaustiveCheck}`);
      }
    }
  }

  return position;
}
