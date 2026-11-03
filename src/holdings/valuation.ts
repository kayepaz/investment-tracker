// Valuing a position at a price, for the bucket tree's Value, Change and Gain/loss columns.

import { Decimal } from '../money/decimal';
import { averageCost, type Position } from './positions';

export type PositionValuation = {
  /** quantity × price, in the position's currency. */
  marketValue: Decimal;
  /** Price movement since purchase, as a percentage of average cost (4 decimal places); null without a cost. */
  changePercent: Decimal | null;
  /** Market value minus cost plus income received, in the position's currency. */
  gainLoss: Decimal;
};

const HUNDRED = Decimal.fromInteger(100);

/** Values a position. Cash is always worth face value, so its price is ignored. Returns null without a price. */
export function valuePosition(position: Position, price: Decimal | null): PositionValuation | null {
  const unitPrice = position.isCash ? Decimal.ONE : price;
  if (!unitPrice) return null;
  const marketValue = position.quantity.times(unitPrice);
  const avg = averageCost(position);
  const changePercent =
    avg && !avg.isZero() ? unitPrice.minus(avg).times(HUNDRED).dividedBy(avg, 4) : null;
  const gainLoss = marketValue.minus(position.cost).plus(position.income);
  return { marketValue, changePercent, gainLoss };
}

/** Converts an amount using a rate quoted as target-currency units per one source unit. */
export function convert(amount: Decimal, rate: Decimal): Decimal {
  return amount.times(rate);
}

/** Share of a total as a percentage (4 decimal places); null when the total is zero. */
export function percentOf(part: Decimal, total: Decimal): Decimal | null {
  if (total.isZero()) return null;
  return part.times(HUNDRED).dividedBy(total, 4);
}
