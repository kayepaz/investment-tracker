# Vision

## The problem

Most investors decide *why* they are buying something at the moment they buy it, and then never look at that reason again. Brokerage apps show prices and balances, but not whether a holding still fits the plan behind it. Plans drift quietly: a position grows past the size you meant it to be, a stop loss you promised yourself passes without notice, a thesis stops being true.

## What Investment Tracker does

It keeps your plan next to your money, and tells you when they disagree.

- You record **why** you hold something and **what would make you act**.
- The app checks the measurable parts automatically and reminds you to re-read the rest.
- Every warning can be acknowledged, snoozed, or answered with an action, and all of it lands in a journal, so over time you can see how well you followed your own plan.

## What it will not do

- Hold your data on someone else's server.
- Tell you what to buy or sell.
- Require an account, subscription or tracking.

## Principles that guide decisions

1. **Privacy by architecture.** Local SQLite, no backend. Features that would need a server are designed as optional add-ons the user runs themselves, or not built.
2. **Correct money math.** Amounts never pass through floating point. Tax-related numbers are explainable from the transactions that produced them.
3. **Plans are the user's.** The app evaluates goals; it does not invent them.
4. **Pluggable edges.** Market data providers, brokerage importers and tax jurisdictions are plug-ins, so contributors can add their own without touching the core.
5. **Phone first.** Most checking happens on a phone; the layouts start there.

## Roadmap (high level)

- **Milestone 1:** accounts and transactions, the bucket tree, totals in your native currency, portfolio and bucket rules with warning badges.
- **Toward v1:** strategies and goals, thesis journal and reviews, Canadian tax (pooled ACB, capital gains, TFSA/RRSP contribution room, foreign withholding), live end-of-day prices and FX, encrypted backups, value and allocation charts.
- **After v1:** brokerage CSV importers, push notifications, multi-device use, more tax jurisdictions.

Product decisions are recorded in [docs/decisions.md](docs/decisions.md).
