import type { Migration } from '../migrate';

// User database: everything the user created, or that can't be re-downloaded.
// Never edit a migration once released; add a new one. See docs/data-model.md.
//
// Conventions (enforced here where SQLite can, otherwise in the app layer):
//   id columns      TEXT UUID v7
//   *_date columns  TEXT 'YYYY-MM-DD'
//   *_at columns    INTEGER milliseconds since epoch, UTC
//   amounts, prices, quantities, rates  TEXT exact decimal strings

const DATE_CHECK = (column: string) =>
  `CHECK (${column} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')`;
const CURRENCY_CHECK = (column: string) => `CHECK (${column} GLOB '[A-Z][A-Z][A-Z]')`;

export const USER_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core: settings, accounts, securities, transactions, buckets, tags, rules',
    sql: `
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

-- API keys live in their own table so unencrypted backups can strip them cleanly.
CREATE TABLE api_keys (
  provider_id  TEXT PRIMARY KEY,
  api_key      TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  institution   TEXT,
  -- Account types are defined by the tax jurisdiction plug-in (e.g. 'tfsa', 'rrsp', 'non_registered').
  account_type  TEXT NOT NULL,
  currency      TEXT NOT NULL ${CURRENCY_CHECK('currency')},
  opened_date   TEXT ${DATE_CHECK('opened_date')},
  closed_date   TEXT ${DATE_CHECK('closed_date')},
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;

-- The user's instrument records. instrument_key is provider-neutral and links to the market cache:
--   'XTSE:XIU'  exchange MIC + ticker      'CASH:CAD'  cash in a currency
--   'USER:<id>' something only priced manually (e.g. real estate)
CREATE TABLE securities (
  id              TEXT PRIMARY KEY,
  instrument_key  TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('stock', 'etf', 'fund', 'bond', 'cash', 'crypto', 'real_estate', 'other')),
  symbol          TEXT,
  exchange        TEXT,
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL ${CURRENCY_CHECK('currency')},
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE transactions (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  security_id      TEXT NOT NULL REFERENCES securities (id) ON DELETE RESTRICT,
  type             TEXT NOT NULL CHECK (type IN (
                     'opening_balance', 'buy', 'sell', 'dividend', 'interest', 'distribution',
                     'return_of_capital', 'deposit', 'withdrawal', 'fee', 'transfer_in', 'transfer_out', 'split')),
  trade_date       TEXT NOT NULL ${DATE_CHECK('trade_date')},
  settlement_date  TEXT ${DATE_CHECK('settlement_date')},
  quantity         TEXT,
  price            TEXT,
  -- Gross amount in the transaction currency, before fees; always non-negative. The type gives the direction.
  amount           TEXT NOT NULL,
  fee              TEXT NOT NULL DEFAULT '0',
  withholding_tax  TEXT NOT NULL DEFAULT '0',
  currency         TEXT NOT NULL ${CURRENCY_CHECK('currency')},
  -- FX rate from the transaction currency to the tax jurisdiction's currency on the trade date,
  -- copied here when entered so tax figures never change if the market cache is cleared.
  tax_fx_rate      TEXT NOT NULL,
  tax_fx_source    TEXT NOT NULL CHECK (tax_fx_source IN ('same_currency', 'bank_of_canada', 'manual', 'import')),
  notes            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
) STRICT;

CREATE INDEX transactions_by_account ON transactions (account_id, trade_date);
CREATE INDEX transactions_by_security ON transactions (security_id, trade_date);

CREATE TABLE buckets (
  id             TEXT PRIMARY KEY,
  parent_id      TEXT REFERENCES buckets (id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_unassigned  INTEGER NOT NULL DEFAULT 0 CHECK (is_unassigned IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (is_unassigned = 0 OR parent_id IS NULL)
) STRICT;

-- Exactly one built-in "Unassigned" bucket.
CREATE UNIQUE INDEX one_unassigned_bucket ON buckets (is_unassigned) WHERE is_unassigned = 1;

-- A holding is a security within an account; each is assigned, in full, to one bucket.
-- Holdings without a row here are treated as Unassigned. (Leaf-only placement is enforced in the app.)
CREATE TABLE holding_buckets (
  account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  security_id  TEXT NOT NULL REFERENCES securities (id) ON DELETE CASCADE,
  bucket_id    TEXT NOT NULL REFERENCES buckets (id) ON DELETE RESTRICT,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, security_id)
) STRICT;

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE security_tags (
  security_id  TEXT NOT NULL REFERENCES securities (id) ON DELETE CASCADE,
  tag_id       TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (security_id, tag_id)
) STRICT;

-- Portfolio or bucket-scoped limits. scope_bucket_id NULL means the whole portfolio.
-- params is JSON whose shape depends on kind (thresholds as decimal strings).
CREATE TABLE rules (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('concentration', 'allocation', 'cash_floor', 'currency_exposure')),
  name             TEXT NOT NULL,
  scope_bucket_id  TEXT REFERENCES buckets (id) ON DELETE CASCADE,
  params           TEXT NOT NULL CHECK (json_valid(params)),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
) STRICT;

-- How the user answered a warning. warning_key identifies the rule or goal and its subject,
-- e.g. 'rule:<rule id>:holding:<account id>:<security id>'.
CREATE TABLE warning_responses (
  id            TEXT PRIMARY KEY,
  warning_key   TEXT NOT NULL,
  response      TEXT NOT NULL CHECK (response IN ('acknowledged', 'snoozed', 'action_recorded')),
  note          TEXT,
  snooze_until  TEXT ${DATE_CHECK('snooze_until')},
  created_at    INTEGER NOT NULL,
  CHECK (response <> 'snoozed' OR snooze_until IS NOT NULL)
) STRICT;

CREATE INDEX warning_responses_by_key ON warning_responses (warning_key, created_at);

-- Prices the user typed in (manual valuations, or securities no provider covers).
-- They can't be re-downloaded, so they live here rather than in the market cache.
CREATE TABLE manual_prices (
  id           TEXT PRIMARY KEY,
  security_id  TEXT NOT NULL REFERENCES securities (id) ON DELETE CASCADE,
  price_date   TEXT NOT NULL ${DATE_CHECK('price_date')},
  price        TEXT NOT NULL,
  currency     TEXT NOT NULL ${CURRENCY_CHECK('currency')},
  note         TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (security_id, price_date)
) STRICT;
`,
  },
];
