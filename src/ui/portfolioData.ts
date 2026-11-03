import type { Bucket } from '../db/bucketsRepo';
import { db } from '../db/client';
import type { Security } from '../db/repo';
import { DEFAULT_NATIVE_CURRENCY, SETTING_NATIVE_CURRENCY, cashSecurityResolver, toTransactionInputs } from '../db/repo';
import { computePositions } from '../holdings/positions';
import { Decimal } from '../money/decimal';
import { buildPortfolioTree, type PortfolioTree, type PriceQuote } from '../portfolio/tree';

export type PortfolioData = {
  tree: PortfolioTree;
  buckets: Bucket[];
  securities: Map<string, Security>;
  /** Date of the newest exchange rate in the cache, if any. */
  fxDate: string | null;
  /** Transactions that couldn't be applied (shown on their account screens). */
  problemCount: number;
};

export async function loadPortfolio(): Promise<PortfolioData> {
  const [buckets, assignments, transactions, accounts, manualPrices, fxRates, native] = await Promise.all([
    db('listBuckets'),
    db('listAssignments'),
    db('listAllTransactions'),
    db('listAccounts'),
    db('latestManualPrices'),
    db('latestFxRates'),
    db('getSetting', SETTING_NATIVE_CURRENCY),
  ]);

  const { positions, problems } = computePositions(toTransactionInputs(transactions), {
    cashSecurityId: cashSecurityResolver(transactions),
  });
  const securities = new Map(transactions.map((t) => [t.securityId, t.security]));

  const prices = new Map<string, PriceQuote>();
  for (const p of manualPrices) {
    prices.set(p.securityId, { price: Decimal.parse(p.price), date: p.priceDate, source: 'manual' });
  }

  const cadPerUnit = new Map<string, Decimal>();
  let fxDate: string | null = null;
  for (const r of fxRates) {
    if (r.quote !== 'CAD') continue;
    cadPerUnit.set(r.base, Decimal.parse(r.rate));
    if (!fxDate || r.rateDate > fxDate) fxDate = r.rateDate;
  }

  const tree = buildPortfolioTree({
    buckets,
    assignments,
    positions,
    securities,
    accountNames: new Map(accounts.map((a) => [a.id, a.name])),
    prices,
    cadPerUnit,
    nativeCurrency: native ?? DEFAULT_NATIVE_CURRENCY,
  });

  return { tree, buckets, securities, fxDate, problemCount: problems.length };
}
