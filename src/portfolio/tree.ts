// The bucket tree: every open holding placed in its bucket, valued in the native currency,
// with totals rolled up through nested buckets.
//
// Conversions go through CAD, because the Bank of Canada publishes every rate against CAD.
// Bucket "change" and gain/loss compare today's value with cost converted at today's rate, so
// they include currency movement; tax figures use the rates stored on transactions instead.

import type { Bucket, HoldingAssignment } from '../db/bucketsRepo';
import type { Security } from '../db/repo';
import { isOpen, type Position } from '../holdings/positions';
import { percentOf, valuePosition } from '../holdings/valuation';
import { Decimal } from '../money/decimal';

const CONVERSION_SCALE = 10;
const HUNDRED = Decimal.fromInteger(100);

export type PriceQuote = { price: Decimal; date: string; source: 'manual' | 'provider' };

export type TreeInputs = {
  buckets: Bucket[];
  assignments: HoldingAssignment[];
  /** Positions from every account; closed ones are ignored. */
  positions: Position[];
  securities: Map<string, Security>;
  accountNames: Map<string, string>;
  /** Latest price per security id. */
  prices: Map<string, PriceQuote>;
  /** CAD per one unit of each currency. CAD itself may be omitted. */
  cadPerUnit: Map<string, Decimal>;
  nativeCurrency: string;
};

export type HoldingRow = {
  key: string;
  accountId: string;
  securityId: string;
  label: string;
  accountName: string;
  isCash: boolean;
  currency: string;
  quantity: Decimal;
  price: PriceQuote | null;
  /** Native-currency figures; null when the price or an exchange rate is missing. */
  value: Decimal | null;
  cost: Decimal | null;
  gain: Decimal | null;
  /** Price movement since purchase in the holding's own currency (no currency effect). */
  changePercent: Decimal | null;
  share: Decimal | null;
  missing: 'price' | 'fx' | null;
};

export type BucketNode = {
  bucket: Bucket;
  children: BucketNode[];
  holdings: HoldingRow[];
  /** Sums over holdings that could be valued. */
  value: Decimal;
  cost: Decimal;
  gain: Decimal;
  changePercent: Decimal | null;
  share: Decimal | null;
  /** Holdings in this bucket and below without a value (missing price or rate). */
  unvalued: number;
  holdingCount: number;
};

export type PortfolioTree = {
  nativeCurrency: string;
  roots: BucketNode[];
  total: { value: Decimal; cost: Decimal; gain: Decimal; changePercent: Decimal | null; unvalued: number; holdingCount: number };
};

/** Converts between currencies via CAD; null when a rate is missing. */
export function makeConverter(cadPerUnit: Map<string, Decimal>, target: string) {
  const rate = (currency: string) => (currency === 'CAD' ? Decimal.ONE : (cadPerUnit.get(currency) ?? null));
  return (amount: Decimal, from: string): Decimal | null => {
    if (from === target) return amount;
    const fromRate = rate(from);
    const toRate = rate(target);
    if (!fromRate || !toRate || toRate.isZero()) return null;
    return amount.times(fromRate).dividedBy(toRate, CONVERSION_SCALE);
  };
}

function holdingLabel(security: Security | undefined): string {
  if (!security) return 'Unknown';
  if (security.kind === 'cash') return `${security.currency} cash`;
  return security.symbol ?? security.name;
}

function changeOf(value: Decimal, cost: Decimal): Decimal | null {
  if (cost.isZero()) return null;
  return value.minus(cost).times(HUNDRED).dividedBy(cost, 4);
}

export function buildPortfolioTree(inputs: TreeInputs): PortfolioTree {
  const convert = makeConverter(inputs.cadPerUnit, inputs.nativeCurrency);
  const unassigned = inputs.buckets.find((b) => b.isUnassigned);
  const bucketIds = new Set(inputs.buckets.map((b) => b.id));
  const assignment = new Map(inputs.assignments.map((a) => [`${a.accountId}|${a.securityId}`, a.bucketId]));

  // Value every open holding.
  const rowsByBucket = new Map<string, HoldingRow[]>();
  for (const position of inputs.positions.filter(isOpen)) {
    const key = `${position.accountId}|${position.securityId}`;
    const assigned = assignment.get(key);
    const bucketId = assigned && bucketIds.has(assigned) ? assigned : unassigned?.id;
    if (!bucketId) continue;
    const security = inputs.securities.get(position.securityId);
    const price = position.isCash ? null : (inputs.prices.get(position.securityId) ?? null);
    const valuation = valuePosition(position, price?.price ?? null);
    const value = valuation ? convert(valuation.marketValue, position.currency) : null;
    const cost = valuation ? convert(position.cost, position.currency) : null;
    const gain = valuation ? convert(valuation.gainLoss, position.currency) : null;
    const row: HoldingRow = {
      key,
      accountId: position.accountId,
      securityId: position.securityId,
      label: holdingLabel(security),
      accountName: inputs.accountNames.get(position.accountId) ?? '',
      isCash: position.isCash,
      currency: position.currency,
      quantity: position.quantity,
      price,
      value,
      cost,
      gain,
      changePercent: position.isCash ? null : (valuation?.changePercent ?? null),
      share: null,
      missing: !valuation ? 'price' : value === null ? 'fx' : null,
    };
    const list = rowsByBucket.get(bucketId) ?? [];
    list.push(row);
    rowsByBucket.set(bucketId, list);
  }

  // Build nodes bottom-up.
  const childrenOf = new Map<string | null, Bucket[]>();
  for (const bucket of inputs.buckets) {
    const parent = bucket.parentId && bucketIds.has(bucket.parentId) ? bucket.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), bucket]);
  }

  const ordered = (list: Bucket[]) =>
    [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  function build(bucket: Bucket): BucketNode {
    const children = ordered(childrenOf.get(bucket.id) ?? []).map(build);
    const holdings = (rowsByBucket.get(bucket.id) ?? []).sort((a, b) => a.label.localeCompare(b.label));
    let value = Decimal.ZERO;
    let cost = Decimal.ZERO;
    let gain = Decimal.ZERO;
    let unvalued = 0;
    let holdingCount = holdings.length;
    for (const h of holdings) {
      if (h.value && h.cost && h.gain) {
        value = value.plus(h.value);
        cost = cost.plus(h.cost);
        gain = gain.plus(h.gain);
      } else {
        unvalued += 1;
      }
    }
    for (const child of children) {
      value = value.plus(child.value);
      cost = cost.plus(child.cost);
      gain = gain.plus(child.gain);
      unvalued += child.unvalued;
      holdingCount += child.holdingCount;
    }
    return { bucket, children, holdings, value, cost, gain, changePercent: changeOf(value, cost), share: null, unvalued, holdingCount };
  }

  const roots = ordered(childrenOf.get(null) ?? [])
    .map(build)
    // Unassigned goes last, and only appears when it holds something.
    .filter((node) => !node.bucket.isUnassigned || node.holdingCount > 0)
    .sort((a, b) => Number(a.bucket.isUnassigned) - Number(b.bucket.isUnassigned));

  const total = roots.reduce(
    (acc, node) => ({
      value: acc.value.plus(node.value),
      cost: acc.cost.plus(node.cost),
      gain: acc.gain.plus(node.gain),
      unvalued: acc.unvalued + node.unvalued,
      holdingCount: acc.holdingCount + node.holdingCount,
    }),
    { value: Decimal.ZERO, cost: Decimal.ZERO, gain: Decimal.ZERO, unvalued: 0, holdingCount: 0 },
  );

  // Shares of the total portfolio.
  const setShares = (node: BucketNode) => {
    node.share = percentOf(node.value, total.value);
    for (const h of node.holdings) h.share = h.value ? percentOf(h.value, total.value) : null;
    node.children.forEach(setShares);
  };
  roots.forEach(setShares);

  return {
    nativeCurrency: inputs.nativeCurrency,
    roots,
    total: { ...total, changePercent: changeOf(total.value, total.cost) },
  };
}

/** Every bucket as an indented list (for pickers), parents before children. */
export function flattenBuckets(buckets: Bucket[]): { bucket: Bucket; depth: number; isLeaf: boolean }[] {
  const ids = new Set(buckets.map((b) => b.id));
  const childrenOf = new Map<string | null, Bucket[]>();
  for (const bucket of buckets) {
    const parent = bucket.parentId && ids.has(bucket.parentId) ? bucket.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), bucket]);
  }
  const out: { bucket: Bucket; depth: number; isLeaf: boolean }[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(childrenOf.get(parent) ?? [])].sort(
      (a, b) => Number(a.isUnassigned) - Number(b.isUnassigned) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    for (const bucket of list) {
      const kids = childrenOf.get(bucket.id) ?? [];
      out.push({ bucket, depth, isLeaf: kids.length === 0 });
      walk(bucket.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
