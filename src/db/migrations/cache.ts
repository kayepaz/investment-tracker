import type { Migration } from '../migrate';

// Market cache database: everything downloaded from providers. It can be deleted and rebuilt
// at any time, so it never references user-database rows; it is keyed by provider-neutral
// instrument keys (e.g. 'XTSE:XIU') and currency pairs. See docs/data-model.md.

export const CACHE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'prices, fx rates, fetch log',
    sql: `
-- Closing prices. interval '1d' = daily, '1w' = weekly (used for long averages before
-- enough daily history has accumulated). close is an exact decimal string.
CREATE TABLE prices (
  instrument_key  TEXT NOT NULL,
  interval        TEXT NOT NULL CHECK (interval IN ('1d', '1w')),
  price_date      TEXT NOT NULL CHECK (price_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  close           TEXT NOT NULL,
  currency        TEXT NOT NULL,
  provider_id     TEXT NOT NULL,
  fetched_at      INTEGER NOT NULL,
  PRIMARY KEY (instrument_key, interval, price_date)
) STRICT, WITHOUT ROWID;

-- rate = units of quote currency per one unit of base currency on rate_date.
CREATE TABLE fx_rates (
  base         TEXT NOT NULL,
  quote        TEXT NOT NULL,
  rate_date    TEXT NOT NULL CHECK (rate_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  rate         TEXT NOT NULL,
  provider_id  TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  PRIMARY KEY (base, quote, rate_date)
) STRICT, WITHOUT ROWID;

-- Every request made to a provider, so the app can stay within daily limits and explain gaps.
CREATE TABLE fetch_log (
  id              INTEGER PRIMARY KEY,
  provider_id     TEXT NOT NULL,
  request_kind    TEXT NOT NULL,
  instrument_key  TEXT,
  requested_at    INTEGER NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'rate_limited', 'blocked')),
  detail          TEXT
) STRICT;

CREATE INDEX fetch_log_by_provider_time ON fetch_log (provider_id, requested_at);
`,
  },
];
