# Product Decisions

This is the record of product and design decisions for Investment Tracker. It was captured during initial scoping on 2026-11-02 and is updated as decisions are made or changed. Proposals that conflict with a decision here should start as an issue.

## Governance & licensing

- Open source, built for others to use and contribute to.
- BDFL: Kaye Pasenau.
- License: AGPLv3.

## Scope of v1

- v1 includes tax features and full transaction history.
- **Milestone 1:** accounts and holdings, the bucket tree, totals in the native currency, rule warnings.
- One person (taxpayer) per database. A spouse or other household member uses a separate database.
- No joint accounts in v1.

## Accounts and buckets

- **Accounts** hold the transaction ledger and mirror real brokerage accounts (e.g. "Questrade TFSA"). Account type (TFSA, RRSP, non-registered, US accounts) lives on the account.
- **Buckets** group holdings drawn from one or more accounts (e.g. "AI theme" spanning TFSA and RRSP). Strategies are applied to buckets.
- **Buckets nest.** Totals and rule evaluation roll up the tree.
- **One bucket per holding.** Each holding (a position within an account) belongs, in full, to exactly one leaf bucket. No splitting and no double counting.
- **Default "Unassigned" bucket** for holdings not yet placed.
- **Strategies combine additively.** A holding is evaluated against every strategy on its bucket and all ancestor buckets.
- **Cash is a holding** (e.g. "CAD cash", "USD cash").
- **Classification is by user tags only** in v1. Allocation targets and concentration rules are defined over tags. New users get an editable starter tag set.

## Goals

- Structured goals are evaluated automatically; free-text goals (thesis statements) are journal entries with review prompts.
- Thesis review triggers: fixed cadence, price moves beyond X% since the last review, a related warning on the holding, and earnings dates (where data is available).
- Goals evaluate **per holding**.
- Trend goals: moving-average checks, comparison against a user-chosen benchmark, or journal-only.
- Stop-loss reference point: purchase price.

## Strategies

- **Versioned.** A bucket records the strategy version it was applied with; the user chooses when to upgrade.

## Rules

- Kinds: concentration limits, allocation targets by tag with drift tolerance, cash/liquidity floor, currency exposure limits.
- Each rule has a **scope**: the whole portfolio, or a bucket (and everything nested in it).
- A rule broken by one holding shows its warning on that holding. A rule about a group shows on the bucket it applies to and rolls up.
- Proposed: portfolio-scope group rules show on the total-portfolio header.

## Warnings

- The user can acknowledge with a note (logged to the journal), snooze, or record the action taken.
- No permanent per-holding exceptions.

## Screens

- Phone first; layouts widen on desktop.
- Tabs: Buckets (home), Accounts, Strategies, Journal, Settings (rules, tags, providers, backup). Drill-down within Buckets: bucket → sub-bucket → holding.
- **Home is the bucket tree.** Each row shows value (native currency), % of total, change (% price movement since purchase), and gain/loss (dollar amount including dividends).
- Warnings appear as **badges on the tree**, rolling up from children, plus a **"show all warnings" filter**. No separate warnings tab.
- The holding screen focuses on goal status and the thesis & journal.
- Transactions are added from the account screen.
- Charts in v1: value over time, and tag allocation vs targets.

## Data entry

- Sources: manual entry, brokerage CSV import, live prices via the user's own API key, manual valuations for non-market assets.
- Full transaction history per account. A snapshot entry (quantity + average cost) is recorded as an opening-balance transaction.
- Brokerage CSV importers are deferred. Planned first: CIBC Investor's Edge and Questrade. RBC Dominion Securities is not in v1.

## Market data

- Pluggable provider interface for prices, FX rates and event data. Users supply their own API keys.
- First adapters:
  - **EODHD** for end-of-day prices (free plan covers TSX; 20 calls/day; 1 year of history).
  - **Bank of Canada Valet API** for FX rates (free, no key; ~24 currencies vs CAD, with history).
- Later candidate: Finnhub for US earnings dates.
- Prices and FX are cached locally: full history once per holding, then one daily update.
- Rejected for v1: Twelve Data (free plan US-only, non-display use only), Alpha Vantage (25 calls/day, ~100 days of free daily history).

## Tax

- Canada first, with a pluggable jurisdiction model.
- Cost basis method set per jurisdiction (ACB for Canada).
- v1: realized/unrealized capital gains, estimated after-tax value by account type, TFSA/RRSP contribution room with over-contribution warnings, foreign dividend withholding by account type.
- **Pooled ACB:** for Canada, ACB is pooled per security across all non-registered accounts in the database, computed in CAD at each transaction date's FX rate. Registered accounts are excluded. Stop-loss checks still use per-account purchase cost.
- A security identity must match the same security across accounts.

### Contribution room

- Entered by the user with the date it applies to; a new dated entry each year.
- Remaining room (TFSA and RRSP) = latest entered room minus contributions recorded after that date. Withdrawals are not added back.
- Outdated reminders: TFSA after a new calendar year starts; RRSP after the CRA would have posted new room following tax season.

## Currency

- A user-selected native currency for all summaries.
- Current FX for current values; historical FX for gains and charts.

## Alerts

- v1: rules and goals are evaluated when the app opens; results appear as badges.
- Later: push notifications.

## Backup & restore

- Format: a copy of the SQLite database, always including cached market data.
- Optional passphrase encryption. API keys are included only in encrypted backups.
- Triggers: a manual button; a reminder after N days or M changes (user-adjustable); automatic backups to a chosen folder where the browser supports it.
- Restore replaces current data after saving a safety copy.
- Backups record their schema version; older backups are migrated on restore, newer ones are refused.
- The app requests persistent browser storage and validates backups before replacing anything.

## Platform & stack

- PWA, single codebase, local SQLite, no backend.
- React + TypeScript.
- v1 is single-device.
- Data conventions (money representation, IDs, dates) are decided with the data model.

## Accepted risks

- **CORS:** the app calls provider APIs directly from the browser. If a provider blocks this, a user-run local helper may be needed.
