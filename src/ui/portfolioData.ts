import type { Bucket } from '../db/bucketsRepo';
import { db } from '../db/client';
import type { Security } from '../db/repo';
import { DEFAULT_NATIVE_CURRENCY, SETTING_NATIVE_CURRENCY, cashSecurityResolver, toTransactionInputs } from '../db/repo';
import { computePositions } from '../holdings/positions';
import { Decimal } from '../money/decimal';
import { choosePrice } from '../portfolio/prices';
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
  const [buckets, assignments, transactions, accounts, manualPrices, providerPrices, fxRates, native] = await Promise.all([
    db('listBuckets'),
    db('listAssignments'),
    db('listAllTransactions'),
    db('listAccounts'),
    db('latestManualPrices'),
    db('latestDailyPrices'),
    db('latestFxRates'),
    db('getSetting', SETTING_NATIVE_CURRENCY),
  ]);

  const { positions, problems } = computePositions(toTransactionInputs(transactions), {
    cashSecurityId: cashSecurityResolver(transactions),
  });
  const securities = new Map(transactions.map((t) => [t.securityId, t.security]));

  // For each security, the newer of the price entered by hand and the one downloaded.
  const manualById = new Map(manualPrices.map((p) => [p.securityId, { price: p.price, date: p.priceDate }]));
  const providerByKey = new Map(
    providerPrices.map((p) => [p.instrumentKey, { price: p.close, date: p.priceDate, providerId: p.providerId }]),
  );
  const prices = new Map<string, PriceQuote>();
  for (const security of securities.values()) {
    const chosen = choosePrice(manualById.get(security.id), providerByKey.get(security.instrumentKey));
    if (chosen) prices.set(security.id, chosen);
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
