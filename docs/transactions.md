# Transactions and Positions

A **position** (holding) is a security within an account. Positions are never stored. They are worked out from
the account's transactions, in trade-date order, by [`computePositions`](../src/holdings/positions.ts).

## Automatic cash

Cash is a holding like any other (a `cash` security per currency, e.g. `CASH:CAD`). It moves automatically:
a buy takes its cost out of the account's cash in the transaction currency, a sale or dividend puts money back.
To make the cash balance match a brokerage statement, record deposits, or start the account with an opening
cash balance.

Cash can go negative (e.g. on margin, or before the opening balance has been entered); the app shows it as it is.

## What each transaction does

`amount` is the gross amount in the transaction currency, always non-negative; the type gives the direction.
`fee` and `withholding_tax` are separate, also non-negative.

| Type | Recorded against | Position | Cash (transaction currency) |
| --- | --- | --- | --- |
| `opening_balance` | a security | + quantity, + `amount` as cost | — |
| `opening_balance` | cash | — | + amount |
| `buy` | a security | + quantity, + amount + fee as cost | − (amount + fee) |
| `sell` | a security | − quantity, − average cost of the units sold; realized gain = amount − fee − that cost | + (amount − fee) |
| `dividend`, `interest`, `distribution` | a security or cash | + net income (amount − withholding − fee) | + net income |
| `return_of_capital` | a security | − amount from cost; any excess beyond cost counts as a realized gain | + (amount − fee) |
| `deposit` | cash | — | + (amount − fee) |
| `withdrawal` | cash | — | − (amount + fee) |
| `fee` | a security or cash | if a security: − amount from its income | − amount |
| `transfer_in` | a security | + quantity, + amount as cost (book value carried over) | — |
| `transfer_in` / `transfer_out` | cash | — | ± amount |
| `transfer_out` | a security | − quantity, − average cost of the units moved; no gain | — |
| `split` | a security | quantity × ratio (`quantity` holds the ratio: `2` for 2-for-1, `0.1` for 1-for-10); cost unchanged | — |

## Cost

- Position cost is the **average cost in the security's currency, including purchase fees**, for this account
  only. It drives "change since purchase" and stop-loss checks.
- **Tax cost basis is separate.** For Canada, ACB is pooled per security across all non-registered accounts and
  calculated in CAD using the FX rate stored on each transaction. That is the tax plug-in's job.
- A non-cash transaction must be in the security's currency.

## Problems

A transaction that can't be applied is skipped and reported, not silently fixed. Examples: selling more units
than are held on that date, a missing quantity, a negative amount, an invalid decimal, or a deposit recorded
against a stock. The rest of the account is still calculated.

## Valuation

[`valuePosition`](../src/holdings/valuation.ts) gives the bucket tree's columns for a position at a price:

- **Value:** quantity × price (cash at face value).
- **Change:** price movement since purchase, as a percentage of average cost.
- **Gain/loss:** value − cost + income received.

All arithmetic uses the exact [`Decimal`](../src/money/decimal.ts) type. Division rounds to a stated number of
decimal places using banker's rounding; rounding for display is always explicit.
