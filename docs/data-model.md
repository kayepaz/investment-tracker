# Data Model

Investment Tracker keeps everything on the user's device in **two SQLite databases**, run by
[sqlite-wasm](https://sqlite.org/wasm) in a Web Worker on the `opfs-sahpool` storage backend.

| Database | File | Holds | If lost |
| --- | --- | --- | --- |
| **User** | `user.sqlite3` | Everything the user created, or that can't be re-downloaded | Only recoverable from a backup |
| **Market cache** | `cache.sqlite3` | Everything downloaded from data providers | Rebuilt automatically |

Code: [`src/db/`](../src/db). Schemas: [`migrations/user.ts`](../src/db/migrations/user.ts) and
[`migrations/cache.ts`](../src/db/migrations/cache.ts).

## Conventions

These apply to both databases. They are hard to change later, so they need an issue and BDFL approval to revisit.

| What | Stored as | Example | Why |
| --- | --- | --- | --- |
| Record IDs | `TEXT` UUID v7 | `018bcfe5-6800-7a1b-…` | Time-ordered; safe when restoring, importing or merging data from another device |
| Money, prices, quantities, rates | `TEXT` exact decimal | `'54.0700'`, `'0.00125'` | No floating-point rounding; keeps the precision the source gave |
| Calendar/business dates | `TEXT` `YYYY-MM-DD` | `'2026-11-02'` | A trade date has no time zone and must never shift a day |
| Record-keeping timestamps (`*_at`) | `INTEGER` ms since epoch, UTC | `1762100000000` | Unambiguous ordering |
| Currencies | `TEXT` ISO 4217 | `'CAD'` | |

- Decimal strings are canonical: optional `-`, no leading zeros, no exponent (`isDecimalString` in
  [`conventions.ts`](../src/db/conventions.ts)). Arithmetic uses a decimal library, never JavaScript `number`.
- Foreign keys are enforced (`PRAGMA foreign_keys = ON` on every connection). Tables are `STRICT`, so SQLite
  rejects values of the wrong type.
- The database enforces what it can (types, references, date shape, allowed values); business rules, such as
  "holdings only in leaf buckets", live in the app layer and its tests.

## How the two databases relate

- The cache **never references user-database rows** (foreign keys can't cross databases anyway). It is keyed by
  provider-neutral **instrument keys** and currency pairs:
  - `XTSE:XIU`: exchange [MIC](https://www.iso20022.org/market-identifier-codes) + ticker
  - `CASH:CAD`: cash in a currency
  - `USER:<id>`: something priced only manually (e.g. real estate)
- Each security in the user database has an `instrument_key`. Provider adapters translate it to their own symbol
  format (e.g. Alpha Vantage `XIU.TRT`).
- **Clearing the cache is always safe.** Prices and rates re-download within provider limits.
- **Price lookup:** a manual price (user database) wins when it is newer than the cached provider price.
- **Tax figures never depend on the cache.** The FX rate used for a transaction is copied onto the transaction
  (`tax_fx_rate`, `tax_fx_source`) when it is entered.

## User database (schema v1)

| Table | Purpose |
| --- | --- |
| `settings` | Key/value preferences (native currency, tax jurisdiction, …) |
| `api_keys` | Market-data API keys, separate so unencrypted backups can strip them |
| `accounts` | Real brokerage accounts; `account_type` values come from the tax jurisdiction plug-in |
| `securities` | The user's instruments (stocks, ETFs, cash, real estate, …), each with an `instrument_key` |
| `transactions` | The ledger: opening balances, buys, sells, dividends, deposits, fees, transfers, splits… |
| `buckets` | Nested groupings (`parent_id`), plus exactly one built-in **Unassigned** bucket |
| `holding_buckets` | Which bucket each holding (account + security) belongs to; absent means Unassigned |
| `tags`, `security_tags` | User-defined classification used by allocation and concentration rules |
| `rules` | Portfolio- or bucket-scoped limits; `params` is JSON whose shape depends on `kind` |
| `warning_responses` | Acknowledgements, snoozes and recorded actions for warnings |
| `manual_prices` | Prices and valuations the user entered |
| `schema_migrations` | Applied migrations |

Transactions store a non-negative gross `amount` plus `fee` and `withholding_tax`; the `type` gives the direction.
A *holding* is not stored: it is derived from an account's transactions for a security, with cash moving automatically. See [transactions.md](transactions.md).

Later migrations add strategies and goals, the journal, contribution room and event data.

## Market cache (schema v1)

| Table | Purpose |
| --- | --- |
| `prices` | Closing prices by instrument key, interval (`1d` daily, `1w` weekly) and date |
| `fx_rates` | Exchange rates by base/quote currency and date (`rate` = quote per one base) |
| `fetch_log` | Every provider request, for staying within daily limits and explaining gaps |
| `schema_migrations` | Applied migrations |

## Migrations

- Each database has its own ordered migration list (`version` 1, 2, 3, … with no gaps) and its own version.
- Each migration runs in a transaction; a failure rolls back and leaves the previous version intact.
- **Never edit a released migration.** Add a new one.
- Each file is marked with an `application_id` (`ITUS` user, `ITCA` cache), so the app refuses to open the wrong
  kind of file, or a file from something else, e.g. when restoring a backup.
- A database from a newer app version is refused rather than modified.

## Testing

Schema and migration tests run against Node's built-in `node:sqlite` through the same `SqlConnection` interface
the app uses with sqlite-wasm (see [`testing.ts`](../src/db/testing.ts)).
