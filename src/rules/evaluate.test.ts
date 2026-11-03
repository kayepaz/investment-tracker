import { describe, expect, it } from 'vitest';
import type { Bucket } from '../db/bucketsRepo';
import type { WarningResponse } from '../db/rulesRepo';
import type { Security } from '../db/repo';
import type { Position } from '../holdings/positions';
import { Decimal, dec } from '../money/decimal';
import { buildPortfolioTree } from '../portfolio/tree';
import { evaluateRules } from './evaluate';
import type { Rule } from './types';

// Portfolio (CAD):
//   Retirement › TFSA: XIU 600 (TFSA account), cash 100
//   Retirement › RRSP: XIU 200 (RRSP account), ZAG 300
//   AI theme: NVDA 100 USD × 2 = 200 CAD (rate 2)
// Total 1400.
const buckets: Bucket[] = [
  { id: 'u', name: 'Unassigned', parentId: null, sortOrder: 0, isUnassigned: true },
  { id: 'ret', name: 'Retirement', parentId: null, sortOrder: 1, isUnassigned: false },
  { id: 'tfsa', name: 'TFSA', parentId: 'ret', sortOrder: 1, isUnassigned: false },
  { id: 'rrsp', name: 'RRSP', parentId: 'ret', sortOrder: 2, isUnassigned: false },
  { id: 'ai', name: 'AI theme', parentId: null, sortOrder: 2, isUnassigned: false },
];

const security = (id: string, symbol: string, currency = 'CAD', kind: Security['kind'] = 'etf'): Security => ({
  id,
  instrumentKey: `X:${symbol}`,
  kind,
  symbol,
  exchange: 'X',
  name: symbol,
  currency,
});

const pos = (accountId: string, securityId: string, quantity: string, currency = 'CAD', isCash = false): Position => ({
  accountId,
  securityId,
  isCash,
  currency,
  quantity: dec(quantity),
  cost: dec(quantity),
  income: Decimal.ZERO,
  realizedGain: Decimal.ZERO,
  firstTradeDate: '2026-01-01',
});

function tree(withPrices = true) {
  return buildPortfolioTree({
    buckets,
    assignments: [
      { accountId: 'tfsa-acct', securityId: 'xiu', bucketId: 'tfsa' },
      { accountId: 'tfsa-acct', securityId: 'cash', bucketId: 'tfsa' },
      { accountId: 'rrsp-acct', securityId: 'xiu', bucketId: 'rrsp' },
      { accountId: 'rrsp-acct', securityId: 'zag', bucketId: 'rrsp' },
      { accountId: 'us-acct', securityId: 'nvda', bucketId: 'ai' },
    ],
    positions: [
      pos('tfsa-acct', 'xiu', '600'),
      pos('tfsa-acct', 'cash', '100', 'CAD', true),
      pos('rrsp-acct', 'xiu', '200'),
      pos('rrsp-acct', 'zag', '300'),
      pos('us-acct', 'nvda', '2', 'USD'),
    ],
    securities: new Map([
      ['xiu', security('xiu', 'XIU')],
      ['zag', security('zag', 'ZAG')],
      ['nvda', security('nvda', 'NVDA', 'USD', 'stock')],
      ['cash', security('cash', 'CASH', 'CAD', 'cash')],
    ]),
    accountNames: new Map(),
    prices: new Map(
      withPrices
        ? [
            ['xiu', { price: dec('1'), date: '2026-11-02', source: 'manual' as const }],
            ['zag', { price: dec('1'), date: '2026-11-02', source: 'manual' as const }],
            ['nvda', { price: dec('100'), date: '2026-11-02', source: 'manual' as const }],
          ]
        : [['xiu', { price: dec('1'), date: '2026-11-02', source: 'manual' as const }]],
    ),
    cadPerUnit: new Map([['USD', dec('1')]]),
    nativeCurrency: 'CAD',
  });
}

const tags = { equity: 'tag-eq', fixed: 'tag-fi' };
const tagsBySecurity = new Map([
  ['xiu', new Set([tags.equity])],
  ['nvda', new Set([tags.equity])],
  ['zag', new Set([tags.fixed])],
]);

function evaluate(rules: Rule[], responses = new Map<string, WarningResponse>(), withPrices = true) {
  return evaluateRules({
    tree: tree(withPrices),
    rules,
    tagsBySecurity,
    tagNames: new Map([
      [tags.equity, 'Equity'],
      [tags.fixed, 'Fixed income'],
    ]),
    securityLabels: new Map([['xiu', 'XIU']]),
    responses,
    today: '2026-11-02',
  });
}

const rule = (r: Partial<Rule> & Pick<Rule, 'kind' | 'params'>): Rule => ({ id: 'r1', name: 'Rule', scopeBucketId: null, enabled: true, ...r });

describe('evaluateRules', () => {
  it('counts a security across accounts for a concentration limit, and badges each holding’s buckets', () => {
    // XIU: 800 of 1400 = 57.1%.
    const result = evaluate([rule({ kind: 'concentration', params: { subject: 'security', maxPercent: '50' } })]);
    expect(result.warnings.map((w) => w.message)).toEqual(['XIU is 57.1% of the portfolio (limit 50%)']);
    expect(result.holdingCounts.get('tfsa-acct|xiu')).toBe(1);
    expect(result.holdingCounts.get('rrsp-acct|xiu')).toBe(1);
    // Counted once for Retirement even though both holdings are below it.
    expect(result.bucketCounts.get('ret')).toBe(1);
    expect(result.bucketCounts.get('tfsa')).toBe(1);
    expect(result.bucketCounts.get('rrsp')).toBe(1);
    expect(result.bucketCounts.get('ai')).toBeUndefined();
    expect(result.portfolioCount).toBe(0);
  });

  it('limits a rule to its bucket', () => {
    // Within RRSP (500): ZAG is 60%, XIU 40%.
    const result = evaluate([rule({ kind: 'concentration', scopeBucketId: 'rrsp', params: { subject: 'security', maxPercent: '50' } })]);
    expect(result.warnings.map((w) => w.message)).toEqual(['ZAG is 60.0% of RRSP (limit 50%)']);
  });

  it('checks tag concentration on the scope', () => {
    // Equity = XIU 800 + NVDA 200 = 1000 of 1400 = 71.4%.
    const result = evaluate([rule({ kind: 'concentration', params: { subject: 'tag', tagId: tags.equity, maxPercent: '70' } })]);
    expect(result.warnings[0]!.message).toBe('Equity is 71.4% of the portfolio (limit 70%)');
    expect(result.warnings[0]!.target).toEqual({ kind: 'portfolio' });
    expect(result.portfolioCount).toBe(1);
  });

  it('flags allocation drift beyond the tolerance, per target', () => {
    // Equity 71.4% vs 60 ± 5 → above; Fixed income 21.4% vs 25 ± 5 → within.
    const result = evaluate([
      rule({
        kind: 'allocation',
        scopeBucketId: null,
        params: { targets: [{ tagId: tags.equity, percent: '60' }, { tagId: tags.fixed, percent: '25' }], tolerance: '5' },
      }),
    ]);
    expect(result.warnings.map((w) => w.message)).toEqual(['Equity is 71.4% of the portfolio, above its 60% target (± 5%)']);
  });

  it('checks a cash floor on a bucket and badges the bucket and its parents', () => {
    // TFSA: cash 100 of 700 = 14.3%; Retirement: 100 of 1200 = 8.3%.
    const ok = evaluate([rule({ kind: 'cash_floor', scopeBucketId: 'tfsa', params: { minPercent: '10' } })]);
    expect(ok.warnings).toEqual([]);
    const low = evaluate([rule({ kind: 'cash_floor', scopeBucketId: 'ret', params: { minPercent: '10' } })]);
    expect(low.warnings[0]!.message).toBe('Cash is 8.3% of Retirement (minimum 10%)');
    expect(low.bucketCounts.get('ret')).toBe(1);
    expect(low.bucketCounts.get('tfsa')).toBeUndefined();
  });

  it('checks currency exposure', () => {
    // USD: NVDA 200 of 1400 = 14.3%.
    const result = evaluate([rule({ kind: 'currency_exposure', params: { currency: 'USD', maxPercent: '10' } })]);
    expect(result.warnings[0]!.message).toBe('USD holdings are 14.3% of the portfolio (limit 10%)');
  });

  it('hides snoozed or acknowledged warnings from counts until the date passes', () => {
    const r = rule({ kind: 'currency_exposure', params: { currency: 'USD', maxPercent: '10' } });
    const response = (hiddenUntil: string): WarningResponse => ({
      warningKey: 'rule:r1:scope',
      response: 'snoozed',
      note: null,
      hiddenUntil,
      createdAt: 0,
    });
    const hidden = evaluate([r], new Map([['rule:r1:scope', response('2026-11-30')]]));
    expect(hidden.warnings).toHaveLength(1);
    expect(hidden.warnings[0]!.hiddenBy).not.toBeNull();
    expect(hidden.visibleCount).toBe(0);
    expect(hidden.portfolioCount).toBe(0);
    const expired = evaluate([r], new Map([['rule:r1:scope', response('2026-11-01')]]));
    expect(expired.visibleCount).toBe(1);
  });

  it('ignores disabled rules and marks results incomplete when prices are missing', () => {
    expect(evaluate([rule({ kind: 'cash_floor', enabled: false, params: { minPercent: '99' } })]).warnings).toEqual([]);
    const partial = evaluate([rule({ kind: 'cash_floor', params: { minPercent: '50' } })], new Map(), false);
    expect(partial.warnings[0]!.incomplete).toBe(true);
  });
});
