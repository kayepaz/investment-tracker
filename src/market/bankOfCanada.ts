// Bank of Canada Valet API: official daily exchange rates against CAD. Free, no API key, and it
// allows requests straight from the browser. https://www.bankofcanada.ca/valet-api-how-to/

import type { FxRate } from '../db/cacheRepo';
import { isDecimalString } from '../db/conventions';

export const BANK_OF_CANADA_PROVIDER = 'bank_of_canada';
export const FX_LATEST_REQUEST = 'fx_latest';

/** The latest daily rates for every currency the Bank publishes. */
export const LATEST_RATES_URL = 'https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?recent=1';

/** Rates are published once each business day, so there is no point asking more often than this. */
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const SERIES = /^FX([A-Z]{3})CAD$/;

/** Reads a Valet observations response: series like FXUSDCAD → { base: 'USD', quote: 'CAD' }. */
export function parseValetRates(json: unknown): FxRate[] {
  const observations = (json as { observations?: unknown } | null)?.observations;
  if (!Array.isArray(observations)) return [];
  const rates: FxRate[] = [];
  for (const observation of observations as Record<string, unknown>[]) {
    const rateDate = observation.d;
    if (typeof rateDate !== 'string') continue;
    for (const [series, cell] of Object.entries(observation)) {
      const match = SERIES.exec(series);
      const value = (cell as { v?: unknown } | null)?.v;
      if (!match || typeof value !== 'string') continue;
      const rate = value.trim();
      if (!isDecimalString(rate)) continue;
      rates.push({ base: match[1]!, quote: 'CAD', rateDate, rate });
    }
  }
  return rates;
}

export async function fetchLatestRates(fetchFn: typeof fetch = fetch): Promise<FxRate[]> {
  const response = await fetchFn(LATEST_RATES_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Bank of Canada answered HTTP ${response.status}`);
  const rates = parseValetRates(await response.json());
  if (rates.length === 0) throw new Error('Bank of Canada returned no rates');
  return rates;
}
