import { db } from '../db/client';
import { BANK_OF_CANADA_PROVIDER, FX_LATEST_REQUEST, REFRESH_INTERVAL_MS, fetchLatestRates } from './bankOfCanada';

export type RefreshResult = 'fresh' | 'updated' | 'failed';

let inFlight: Promise<RefreshResult> | null = null;

/** Downloads the latest Bank of Canada rates into the market cache, at most every few hours. */
export function refreshFxRatesIfStale(now: number = Date.now()): Promise<RefreshResult> {
  inFlight ??= (async (): Promise<RefreshResult> => {
    const last = await db('lastSuccessfulFetch', BANK_OF_CANADA_PROVIDER, FX_LATEST_REQUEST);
    if (last !== null && now - last < REFRESH_INTERVAL_MS) return 'fresh';
    try {
      const rates = await fetchLatestRates();
      await db('saveFxRates', rates, BANK_OF_CANADA_PROVIDER);
      await db('logFetch', { providerId: BANK_OF_CANADA_PROVIDER, requestKind: FX_LATEST_REQUEST, outcome: 'ok' });
      return 'updated';
    } catch (error) {
      await db('logFetch', {
        providerId: BANK_OF_CANADA_PROVIDER,
        requestKind: FX_LATEST_REQUEST,
        // A TypeError from fetch means the request never got an answer (offline, or blocked).
        outcome: error instanceof TypeError ? 'blocked' : 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
