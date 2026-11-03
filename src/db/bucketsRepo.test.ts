import { beforeEach, describe, expect, it } from 'vitest';
import {
  assignHolding,
  createBucket,
  deleteBucket,
  latestManualPrices,
  listAllTransactions,
  listAssignments,
  listBuckets,
  moveBucket,
  renameBucket,
  setManualPrice,
} from './bucketsRepo';
import { lastSuccessfulFetch, latestFxRates, logFetch, saveFxRates } from './cacheRepo';
import { migrate } from './migrate';
import { CACHE_MIGRATIONS } from './migrations/cache';
import { USER_MIGRATIONS } from './migrations/user';
import { ValidationError, addTransaction, createAccount, findOrCreateSecurity } from './repo';
import { openTestDb, type TestDb } from './testing';

const NOW = 1_762_100_000_000;

describe('buckets', () => {
  let db: TestDb;
  beforeEach(() => {
    db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
  });

  it('always has exactly one Unassigned bucket', () => {
    const first = listBuckets(db, NOW);
    const second = listBuckets(db, NOW + 1);
    expect(first).toHaveLength(1);
    expect(first[0]!.isUnassigned).toBe(true);
    expect(second[0]!.id).toBe(first[0]!.id);
  });

  it('creates nested buckets and protects Unassigned', () => {
    const unassigned = listBuckets(db, NOW)[0]!;
    const retirement = createBucket(db, { name: 'Retirement', parentId: null }, NOW);
    const tfsa = createBucket(db, { name: 'TFSA', parentId: retirement.id }, NOW);
    expect(tfsa.parentId).toBe(retirement.id);
    expect(() => createBucket(db, { name: 'x', parentId: unassigned.id }, NOW)).toThrow(ValidationError);
    expect(() => createBucket(db, { name: 'unassigned', parentId: null }, NOW)).toThrow(/reserved/);
    expect(() => createBucket(db, { name: '  ', parentId: null }, NOW)).toThrow(/name/);
    expect(() => renameBucket(db, unassigned.id, 'Other', NOW)).toThrow(ValidationError);
    expect(() => deleteBucket(db, unassigned.id)).toThrow(ValidationError);
  });

  it('renames and moves buckets, refusing loops', () => {
    const a = createBucket(db, { name: 'A', parentId: null }, NOW);
    const b = createBucket(db, { name: 'B', parentId: a.id }, NOW);
    renameBucket(db, a.id, 'Alpha', NOW);
    expect(listBuckets(db, NOW).find((x) => x.id === a.id)!.name).toBe('Alpha');
    expect(() => moveBucket(db, a.id, b.id, NOW)).toThrow(/inside itself/);
    expect(() => moveBucket(db, a.id, a.id, NOW)).toThrow(/inside itself/);
    moveBucket(db, b.id, null, NOW);
    expect(listBuckets(db, NOW).find((x) => x.id === b.id)!.parentId).toBeNull();
  });

  describe('with a holding', () => {
    let accountId: string;
    let securityId: string;
    beforeEach(() => {
      accountId = createAccount(db, { name: 'TFSA', accountType: 'tfsa', currency: 'CAD', openedDate: '2026-01-01' }, NOW).id;
      securityId = findOrCreateSecurity(db, { kind: 'etf', symbol: 'XIU', exchange: 'XTSE', name: 'XIU', currency: 'CAD' }, NOW).id;
    });

    it('assigns a holding to a leaf bucket, and back to Unassigned', () => {
      const core = createBucket(db, { name: 'Core', parentId: null }, NOW);
      assignHolding(db, { accountId, securityId, bucketId: core.id }, NOW);
      expect(listAssignments(db)).toEqual([{ accountId, securityId, bucketId: core.id }]);
      const unassigned = listBuckets(db, NOW).find((b) => b.isUnassigned)!;
      assignHolding(db, { accountId, securityId, bucketId: unassigned.id }, NOW);
      expect(listAssignments(db)).toEqual([]);
    });

    it('keeps investments only in buckets without sub-buckets', () => {
      const parent = createBucket(db, { name: 'Retirement', parentId: null }, NOW);
      createBucket(db, { name: 'TFSA', parentId: parent.id }, NOW);
      expect(() => assignHolding(db, { accountId, securityId, bucketId: parent.id }, NOW)).toThrow(/sub-buckets/);

      const core = createBucket(db, { name: 'Core', parentId: null }, NOW);
      assignHolding(db, { accountId, securityId, bucketId: core.id }, NOW);
      expect(() => createBucket(db, { name: 'Child', parentId: core.id }, NOW)).toThrow(/holds investments/);
    });

    it('deletes only empty buckets', () => {
      const core = createBucket(db, { name: 'Core', parentId: null }, NOW);
      assignHolding(db, { accountId, securityId, bucketId: core.id }, NOW);
      expect(() => deleteBucket(db, core.id)).toThrow(/Move them/);
      const parent = createBucket(db, { name: 'P', parentId: null }, NOW);
      createBucket(db, { name: 'C', parentId: parent.id }, NOW);
      expect(() => deleteBucket(db, parent.id)).toThrow(/sub-buckets/);
      const empty = createBucket(db, { name: 'Empty', parentId: null }, NOW);
      deleteBucket(db, empty.id);
      expect(listBuckets(db, NOW).some((b) => b.id === empty.id)).toBe(false);
    });

    it('stores manual prices and returns the latest per security', () => {
      setManualPrice(db, { securityId, priceDate: '2026-11-01', price: '53.50', currency: 'CAD' }, NOW);
      setManualPrice(db, { securityId, priceDate: '2026-11-02', price: '54.07', currency: 'CAD' }, NOW);
      setManualPrice(db, { securityId, priceDate: '2026-11-02', price: '54.10', currency: 'CAD' }, NOW + 1);
      expect(latestManualPrices(db)).toEqual([{ securityId, priceDate: '2026-11-02', price: '54.10', currency: 'CAD' }]);
      expect(() => setManualPrice(db, { securityId, priceDate: '2026-11-02', price: '$54', currency: 'CAD' }, NOW)).toThrow(ValidationError);
    });

    it('lists transactions across all accounts', () => {
      const other = createAccount(db, { name: 'RRSP', accountType: 'rrsp', currency: 'CAD', openedDate: '2026-01-01' }, NOW).id;
      addTransaction(db, { accountId, type: 'deposit', tradeDate: '2026-01-02', amount: '10', currency: 'CAD' }, NOW);
      addTransaction(db, { accountId: other, type: 'deposit', tradeDate: '2026-01-02', amount: '20', currency: 'CAD' }, NOW);
      expect(listAllTransactions(db)).toHaveLength(2);
    });
  });
});

describe('market cache: FX rates and fetch log', () => {
  let cache: TestDb;
  beforeEach(() => {
    cache = openTestDb();
    migrate(cache, 'cache', CACHE_MIGRATIONS);
  });

  it('stores rates, keeps the latest per pair, and skips invalid rows', () => {
    const stored = saveFxRates(
      cache,
      [
        { base: 'USD', quote: 'CAD', rateDate: '2026-10-30', rate: '1.3950' },
        { base: 'USD', quote: 'CAD', rateDate: '2026-11-02', rate: '1.3978' },
        { base: 'EUR', quote: 'CAD', rateDate: '2026-11-02', rate: '1.6123' },
        { base: 'XXXX', quote: 'CAD', rateDate: '2026-11-02', rate: '1' },
        { base: 'GBP', quote: 'CAD', rateDate: '2026-11-02', rate: 'n/a' },
      ],
      'bank_of_canada',
      NOW,
    );
    expect(stored).toBe(3);
    const latest = latestFxRates(cache).sort((a, b) => a.base.localeCompare(b.base));
    expect(latest).toEqual([
      { base: 'EUR', quote: 'CAD', rateDate: '2026-11-02', rate: '1.6123' },
      { base: 'USD', quote: 'CAD', rateDate: '2026-11-02', rate: '1.3978' },
    ]);
  });

  it('remembers when a fetch last succeeded', () => {
    expect(lastSuccessfulFetch(cache, 'bank_of_canada', 'fx_latest')).toBeNull();
    logFetch(cache, { providerId: 'bank_of_canada', requestKind: 'fx_latest', outcome: 'error', detail: 'x' }, NOW);
    expect(lastSuccessfulFetch(cache, 'bank_of_canada', 'fx_latest')).toBeNull();
    logFetch(cache, { providerId: 'bank_of_canada', requestKind: 'fx_latest', outcome: 'ok' }, NOW + 5);
    expect(lastSuccessfulFetch(cache, 'bank_of_canada', 'fx_latest')).toBe(NOW + 5);
  });
});
