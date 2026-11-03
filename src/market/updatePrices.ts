// Runs a price update from the page: works out which securities are held, plans requests within
// each provider's limits, and downloads them into the market cache.

import { db } from '../db/client';
import { cashSecurityResolver, toTransactionInputs } from '../db/repo';
import { computePositions, isOpen } from '../holdings/positions';
import { DAY_MS, planPriceUpdates, runPriceUpdates, type PricePlan, type PriceUpdateResult } from './priceUpdates';
import { PRICE_PROVIDERS } from './providers';

export type PriceUpdateSummary = { plan: PricePlan; result: PriceUpdateResult };

let inFlight: Promise<PriceUpdateSummary> | null = null;

export function updatePrices(onProgress?: (done: number, total: number) => void): Promise<PriceUpdateSummary> {
  inFlight ??= (async () => {
    const now = Date.now();
    const [apiKeys, transactions, lastFetches, used] = await Promise.all([
      db('getApiKeys'),
      db('listAllTransactions'),
      db('lastPriceFetches'),
      Promise.all(PRICE_PROVIDERS.map((p) => db('requestsSince', p.id, now - DAY_MS))),
    ]);

    const { positions } = computePositions(toTransactionInputs(transactions), {
      cashSecurityId: cashSecurityResolver(transactions),
    });
    const held = new Set(positions.filter(isOpen).map((p) => p.securityId));
    const securities = [...new Map(transactions.map((t) => [t.securityId, t.security])).values()].filter((s) => held.has(s.id));

    const plan = planPriceUpdates({
      securities,
      apiKeys,
      lastFetched: new Map(lastFetches.map((f) => [f.instrumentKey, f.at])),
      usedToday: new Map(PRICE_PROVIDERS.map((p, i) => [p.id, used[i] ?? 0])),
      now,
    });
    const result = await runPriceUpdates(plan.tasks, {
      apiKeys,
      savePrices: (prices) => db('savePrices', prices),
      logFetch: (entry) => db('logFetch', entry),
      onProgress,
    });
    return { plan, result };
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Requests used per provider in the last 24 hours, for Settings. */
export async function usageToday(): Promise<Record<string, number>> {
  const now = Date.now();
  const counts = await Promise.all(PRICE_PROVIDERS.map((p) => db('requestsSince', p.id, now - DAY_MS)));
  return Object.fromEntries(PRICE_PROVIDERS.map((p, i) => [p.id, counts[i] ?? 0]));
}
