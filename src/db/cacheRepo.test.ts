import { beforeEach, describe, expect, it } from 'vitest';
import { choosePrice } from '../portfolio/prices';
import { lastPriceFetches, latestDailyPrices, logFetch, requestsSince, savePrices } from './cacheRepo';
import { migrate } from './migrate';
import { CACHE_MIGRATIONS } from './migrations/cache';
import { USER_MIGRATIONS } from './migrations/user';
import { ValidationError, deleteApiKey, getApiKeys, setApiKey } from './repo';
import { openTestDb, type TestDb } from './testing';

const NOW = 1_762_100_000_000;

describe('cached prices', () => {
  let cache: TestDb;
  beforeEach(() => {
    cache = openTestDb();
    migrate(cache, 'cache', CACHE_MIGRATIONS);
  });

  it('stores daily closes and returns the latest per instrument', () => {
    const row = (date: string, close: string, key = 'XTSE:XIU') => ({
      instrumentKey: key,
      interval: '1d' as const,
      priceDate: date,
      close,
      currency: 'CAD',
      providerId: 'alphavantage',
    });
    expect(savePrices(cache, [row('2026-10-30', '53.91'), row('2026-11-02', '54.0700'), row('2026-11-02', '230.1', 'XNAS:AAPL'), row('bad', '1')], NOW)).toBe(3);
    // A later fetch replaces the same day's close.
    savePrices(cache, [row('2026-11-02', '54.10')], NOW + 1);
    const latest = latestDailyPrices(cache).sort((a, b) => a.instrumentKey.localeCompare(b.instrumentKey));
    expect(latest.map((p) => [p.instrumentKey, p.priceDate, p.close])).toEqual([
      ['XNAS:AAPL', '2026-11-02', '230.1'],
      ['XTSE:XIU', '2026-11-02', '54.10'],
    ]);
  });

  it('counts requests in a window and remembers each instrument’s last good fetch', () => {
    logFetch(cache, { providerId: 'alphavantage', requestKind: 'price_daily', instrumentKey: 'XTSE:XIU', outcome: 'ok' }, NOW - 1000);
    logFetch(cache, { providerId: 'alphavantage', requestKind: 'price_daily', instrumentKey: 'XTSE:XIU', outcome: 'rate_limited' }, NOW);
    logFetch(cache, { providerId: 'finnhub', requestKind: 'price_daily', instrumentKey: 'XNAS:AAPL', outcome: 'ok' }, NOW);
    expect(requestsSince(cache, 'alphavantage', NOW - 5000)).toBe(2);
    expect(requestsSince(cache, 'alphavantage', NOW)).toBe(1);
    expect(lastPriceFetches(cache).sort((a, b) => a.instrumentKey.localeCompare(b.instrumentKey))).toEqual([
      { instrumentKey: 'XNAS:AAPL', at: NOW },
      { instrumentKey: 'XTSE:XIU', at: NOW - 1000 },
    ]);
  });
});

describe('API keys', () => {
  it('stores, replaces and removes keys, rejecting obvious junk', () => {
    const user = openTestDb();
    migrate(user, 'user', USER_MIGRATIONS);
    setApiKey(user, 'alphavantage', ' ABCD1234 ', NOW);
    setApiKey(user, 'alphavantage', 'EFGH5678', NOW + 1);
    expect(getApiKeys(user)).toEqual({ alphavantage: 'EFGH5678' });
    expect(() => setApiKey(user, 'finnhub', 'not a key!', NOW)).toThrow(ValidationError);
    deleteApiKey(user, 'alphavantage');
    expect(getApiKeys(user)).toEqual({});
  });
});

describe('choosePrice', () => {
  const manual = { price: '55', date: '2026-11-01' };
  const provider = { price: '54.07', date: '2026-11-02', providerId: 'alphavantage' };

  it('uses the newer price, preferring the hand-entered one on the same day', () => {
    expect(choosePrice(manual, provider)).toMatchObject({ source: 'provider', date: '2026-11-02' });
    expect(choosePrice({ ...manual, date: '2026-11-02' }, provider)).toMatchObject({ source: 'manual' });
    expect(choosePrice(manual, undefined)).toMatchObject({ source: 'manual' });
    expect(choosePrice(undefined, provider)?.price.toString()).toBe('54.07');
    expect(choosePrice(undefined, undefined)).toBeNull();
  });
});
