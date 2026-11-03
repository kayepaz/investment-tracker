import { describe, expect, it } from 'vitest';
import type { Bucket } from '../db/bucketsRepo';
import type { Security } from '../db/repo';
import type { Position } from '../holdings/positions';
import { Decimal, dec } from '../money/decimal';
import { buildPortfolioTree, flattenBuckets, makeConverter, type TreeInputs } from './tree';

const bucket = (id: string, name: string, parentId: string | null = null, isUnassigned = false): Bucket => ({
  id,
  name,
  parentId,
  sortOrder: 0,
  isUnassigned,
});

const security = (id: string, symbol: string | null, currency: string, kind: Security['kind'] = 'etf'): Security => ({
  id,
  instrumentKey: symbol ? `XTSE:${symbol}` : `CASH:${currency}`,
  kind,
  symbol,
  exchange: symbol ? 'XTSE' : null,
  name: symbol ?? `${currency} cash`,
  currency,
});

const position = (securityId: string, currency: string, quantity: string, cost: string, extra: Partial<Position> = {}): Position => ({
  accountId: 'acct',
  securityId,
  isCash: false,
  currency,
  quantity: dec(quantity),
  cost: dec(cost),
  income: Decimal.ZERO,
  realizedGain: Decimal.ZERO,
  firstTradeDate: '2026-01-01',
  ...extra,
});

function inputs(overrides: Partial<TreeInputs> = {}): TreeInputs {
  return {
    buckets: [bucket('u', 'Unassigned', null, true), bucket('ret', 'Retirement'), bucket('tfsa', 'TFSA', 'ret'), bucket('ai', 'AI theme')],
    assignments: [
      { accountId: 'acct', securityId: 'xiu', bucketId: 'tfsa' },
      { accountId: 'acct', securityId: 'nvda', bucketId: 'ai' },
    ],
    positions: [
      position('xiu', 'CAD', '10', '500'),
      position('nvda', 'USD', '2', '200'),
      position('cash', 'CAD', '100', '100', { isCash: true }),
    ],
    securities: new Map([
      ['xiu', security('xiu', 'XIU', 'CAD')],
      ['nvda', security('nvda', 'NVDA', 'USD', 'stock')],
      ['cash', security('cash', null, 'CAD', 'cash')],
    ]),
    accountNames: new Map([['acct', 'Questrade TFSA']]),
    prices: new Map([
      ['xiu', { price: dec('55'), date: '2026-11-02', source: 'manual' as const }],
      ['nvda', { price: dec('150'), date: '2026-11-02', source: 'manual' as const }],
    ]),
    cadPerUnit: new Map([['USD', dec('1.4')]]),
    nativeCurrency: 'CAD',
    ...overrides,
  };
}

const s = (d: Decimal | null | undefined) => (d ? d.normalized().toString() : String(d));

describe('makeConverter', () => {
  it('converts through CAD', () => {
    const rates = new Map([
      ['USD', dec('1.4')],
      ['EUR', dec('1.5')],
    ]);
    expect(s(makeConverter(rates, 'CAD')(dec('100'), 'USD'))).toBe('140');
    expect(s(makeConverter(rates, 'USD')(dec('140'), 'CAD'))).toBe('100');
    expect(s(makeConverter(rates, 'EUR')(dec('150'), 'USD'))).toBe('140');
    expect(makeConverter(rates, 'CAD')(dec('1'), 'JPY')).toBeNull();
  });
});

describe('buildPortfolioTree', () => {
  it('places holdings in buckets and rolls values up in the native currency', () => {
    const tree = buildPortfolioTree(inputs());
    const [ai, retirement, unassigned] = tree.roots;
    expect(tree.roots.map((n) => n.bucket.name)).toEqual(['AI theme', 'Retirement', 'Unassigned']);

    // XIU: 10 × 55 = 550, cost 500. NVDA: 2 × 150 = 300 USD = 420 CAD, cost 200 USD = 280 CAD. Cash 100.
    expect(s(retirement!.value)).toBe('550');
    expect(s(retirement!.children[0]!.value)).toBe('550');
    expect(s(ai!.value)).toBe('420');
    expect(s(unassigned!.value)).toBe('100');
    expect(s(tree.total.value)).toBe('1070');
    expect(s(tree.total.gain)).toBe('190');
  });

  it('computes change since purchase and share of total', () => {
    const tree = buildPortfolioTree(inputs());
    const retirement = tree.roots.find((n) => n.bucket.id === 'ret')!;
    expect(s(retirement.changePercent)).toBe('10');
    const nvda = tree.roots.find((n) => n.bucket.id === 'ai')!.holdings[0]!;
    // Price movement in USD only: 100 → 150.
    expect(s(nvda.changePercent)).toBe('50');
    expect(s(retirement.share)).toBe('51.4019');
  });

  it('counts holdings it cannot value instead of guessing', () => {
    const tree = buildPortfolioTree(inputs({ prices: new Map(), cadPerUnit: new Map() }));
    expect(tree.total.unvalued).toBe(2);
    expect(s(tree.total.value)).toBe('100');
    const ai = tree.roots.find((n) => n.bucket.id === 'ai')!;
    expect(ai.holdings[0]!.missing).toBe('price');

    const noFx = buildPortfolioTree(inputs({ cadPerUnit: new Map() }));
    expect(noFx.roots.find((n) => n.bucket.id === 'ai')!.holdings[0]!.missing).toBe('fx');
  });

  it('shows values in another native currency', () => {
    const tree = buildPortfolioTree(inputs({ nativeCurrency: 'USD' }));
    expect(s(tree.roots.find((n) => n.bucket.id === 'ai')!.value)).toBe('300');
  });

  it('puts unassigned and orphaned holdings in Unassigned, and hides it when empty', () => {
    const tree = buildPortfolioTree(
      inputs({ assignments: [{ accountId: 'acct', securityId: 'xiu', bucketId: 'deleted-bucket' }] }),
    );
    const unassigned = tree.roots.find((n) => n.bucket.isUnassigned)!;
    expect(unassigned.holdings.map((h) => h.label).sort()).toEqual(['CAD cash', 'NVDA', 'XIU']);

    const empty = buildPortfolioTree(inputs({ positions: [] }));
    expect(empty.roots.some((n) => n.bucket.isUnassigned)).toBe(false);
    expect(empty.total.value.isZero()).toBe(true);
  });

  it('ignores closed positions', () => {
    const tree = buildPortfolioTree(inputs({ positions: [position('xiu', 'CAD', '0', '0')] }));
    expect(tree.total.holdingCount).toBe(0);
  });
});

describe('flattenBuckets', () => {
  it('lists parents before children with depth and leaf flags, Unassigned last', () => {
    const flat = flattenBuckets(inputs().buckets);
    expect(flat.map((f) => [f.bucket.name, f.depth, f.isLeaf])).toEqual([
      ['AI theme', 0, true],
      ['Retirement', 0, false],
      ['TFSA', 1, true],
      ['Unassigned', 0, true],
    ]);
  });
});
