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
