import { Decimal } from '../money/decimal';
import type { PriceQuote } from './tree';

export type PriceCandidate = { price: string; date: string };

/**
 * The price to value a holding at: the newer of the one entered by hand and the one downloaded.
 * On the same date the hand-entered price wins, since the user chose it deliberately.
 */
export function choosePrice(
  manual: PriceCandidate | undefined,
  provider: (PriceCandidate & { providerId: string }) | undefined,
): PriceQuote | null {
  if (manual && (!provider || manual.date >= provider.date)) {
    return { price: Decimal.parse(manual.price), date: manual.date, source: 'manual' };
  }
  if (provider) {
    return { price: Decimal.parse(provider.price), date: provider.date, source: 'provider', providerId: provider.providerId };
  }
  return null;
}
