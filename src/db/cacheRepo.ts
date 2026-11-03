// Reading and writing the market cache: downloaded FX rates (and, later, prices) plus the fetch log.

import { isCurrencyCode, isDecimalString, isIsoDate } from './conventions';
import type { SqlConnection, SqlValue } from './migrate';
import { withTransaction } from './repo';

const str = (value: SqlValue | undefined): string => (value === null || value === undefined ? '' : String(value));

export type FxRate = {
  /** Currency being priced, e.g. 'USD'. */
  base: string;
  /** Currency the rate is in, e.g. 'CAD'. */
  quote: string;
  rateDate: string;
  /** Units of quote per one unit of base, as an exact decimal string. */
  rate: string;
};

/** Stores rates, replacing any for the same pair and date. Invalid rows are skipped. Returns how many were stored. */
export function saveFxRates(db: SqlConnection, rates: FxRate[], providerId: string, now: number): number {
  const valid = rates.filter(
    (r) => isCurrencyCode(r.base) && isCurrencyCode(r.quote) && isIsoDate(r.rateDate) && isDecimalString(r.rate) && !r.rate.startsWith('-'),
  );
  withTransaction(db, () => {
    for (const r of valid) {
      db.run(
        `INSERT INTO fx_rates (base, quote, rate_date, rate, provider_id, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (base, quote, rate_date) DO UPDATE SET rate = excluded.rate, provider_id = excluded.provider_id, fetched_at = excluded.fetched_at`,
        [r.base, r.quote, r.rateDate, r.rate, providerId, now],
      );
    }
  });
  return valid.length;
}

/** The latest stored rate for each pair. */
export function latestFxRates(db: SqlConnection): FxRate[] {
  return db
    .all(
      `SELECT base, quote, rate_date, rate FROM fx_rates f
       WHERE rate_date = (SELECT max(rate_date) FROM fx_rates WHERE base = f.base AND quote = f.quote)`,
    )
    .map((row) => ({ base: str(row.base), quote: str(row.quote), rateDate: str(row.rate_date), rate: str(row.rate) }));
}

export type FetchOutcome = 'ok' | 'error' | 'rate_limited' | 'blocked';

export function logFetch(
  db: SqlConnection,
  entry: { providerId: string; requestKind: string; instrumentKey?: string; outcome: FetchOutcome; detail?: string },
  now: number,
): void {
  db.run(
    `INSERT INTO fetch_log (provider_id, request_kind, instrument_key, requested_at, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.providerId, entry.requestKind, entry.instrumentKey ?? null, now, entry.outcome, entry.detail ?? null],
  );
}

/** When a request of this kind last succeeded, or null. */
export function lastSuccessfulFetch(db: SqlConnection, providerId: string, requestKind: string): number | null {
  const value = db.all(
    `SELECT max(requested_at) AS at FROM fetch_log WHERE provider_id = ? AND request_kind = ? AND outcome = 'ok'`,
    [providerId, requestKind],
  )[0]?.at;
  return value === null || value === undefined ? null : Number(value);
}

// ---------------------------------------------------------------------------------------------
// Prices

export type CachedPrice = {
  instrumentKey: string;
  interval: '1d' | '1w';
  priceDate: string;
  /** Exact decimal string. */
  close: string;
  currency: string;
  providerId: string;
};

/** Stores closing prices, replacing any for the same instrument, interval and date. Invalid rows are skipped. */
export function savePrices(db: SqlConnection, prices: CachedPrice[], now: number): number {
  const valid = prices.filter(
    (p) => p.instrumentKey && isIsoDate(p.priceDate) && isDecimalString(p.close) && !p.close.startsWith('-') && isCurrencyCode(p.currency),
  );
  withTransaction(db, () => {
    for (const p of valid) {
      db.run(
        `INSERT INTO prices (instrument_key, interval, price_date, close, currency, provider_id, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (instrument_key, interval, price_date) DO UPDATE SET
           close = excluded.close, currency = excluded.currency, provider_id = excluded.provider_id, fetched_at = excluded.fetched_at`,
        [p.instrumentKey, p.interval, p.priceDate, p.close, p.currency, p.providerId, now],
      );
    }
  });
  return valid.length;
}

/** The latest daily price for each instrument. */
export function latestDailyPrices(db: SqlConnection): CachedPrice[] {
  return db
    .all(
      `SELECT instrument_key, interval, price_date, close, currency, provider_id FROM prices p
       WHERE interval = '1d' AND price_date = (
         SELECT max(price_date) FROM prices WHERE instrument_key = p.instrument_key AND interval = '1d')`,
    )
    .map((row) => ({
      instrumentKey: str(row.instrument_key),
      interval: '1d' as const,
      priceDate: str(row.price_date),
      close: str(row.close),
      currency: str(row.currency),
      providerId: str(row.provider_id),
    }));
}

/** Requests made to a provider since a time (any outcome), for staying within daily limits. */
export function requestsSince(db: SqlConnection, providerId: string, since: number): number {
  return Number(
    db.all('SELECT count(*) AS n FROM fetch_log WHERE provider_id = ? AND requested_at >= ?', [providerId, since])[0]?.n ?? 0,
  );
}

/** When each instrument's price was last fetched successfully, by any provider. */
export function lastPriceFetches(db: SqlConnection): { instrumentKey: string; at: number }[] {
  return db
    .all(
      `SELECT instrument_key, max(requested_at) AS at FROM fetch_log
       WHERE request_kind = 'price_daily' AND outcome = 'ok' AND instrument_key IS NOT NULL
       GROUP BY instrument_key`,
    )
    .map((row) => ({ instrumentKey: str(row.instrument_key), at: Number(row.at) }));
}
