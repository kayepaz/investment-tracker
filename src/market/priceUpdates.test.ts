import { describe, expect, it } from 'vitest';
import type { CachedPrice } from '../db/cacheRepo';
import type { Security } from '../db/repo';
import { DAY_MS, planPriceUpdates, runPriceUpdates } from './priceUpdates';

const NOW = Date.UTC(2026, 10, 2, 22);

function sec(symbol: string, exchange: string | null, currency = exchange && exchange.startsWith('XN') ? 'USD' : 'CAD'): Security {
  return {
    id: `id-${symbol}`,
    instrumentKey: exchange ? `${exchange}:${symbol}` : `USER:${symbol}`,
    kind: exchange ? 'stock' : 'real_estate',
    symbol: exchange ? symbol : null,
    exchange,
    name: symbol,
    currency,
  };
}

const XIU = sec('XIU', 'XTSE');
const ZAG = sec('ZAG', 'XTSE');
const AAPL = sec('AAPL', 'XNAS');
const CABIN = sec('CABIN', null);

describe('planPriceUpdates', () => {
  const base = { lastFetched: new Map<string, number>(), usedToday: new Map<string, number>(), now: NOW };

  it('uses Alpha Vantage for everything listed when it is the only key', () => {
    const plan = planPriceUpdates({ ...base, securities: [XIU, AAPL, CABIN], apiKeys: { alphavantage: 'k' } });
    expect(plan.tasks.map((t) => [t.security.symbol, t.providerId, t.symbol])).toEqual([
      ['XIU', 'alphavantage', 'XIU.TRT'],
      ['AAPL', 'alphavantage', 'AAPL'],
    ]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['not_listed']);
  });

  it('prefers Finnhub for US listings when its key is set', () => {
    const plan = planPriceUpdates({ ...base, securities: [XIU, AAPL], apiKeys: { alphavantage: 'k', finnhub: 'f' } });
    expect(plan.tasks.map((t) => t.providerId)).toEqual(['alphavantage', 'finnhub']);
  });

  it('reports holdings no key covers', () => {
    const plan = planPriceUpdates({ ...base, securities: [XIU, AAPL], apiKeys: { finnhub: 'f' } });
    expect(plan.tasks.map((t) => t.security.symbol)).toEqual(['AAPL']);
    expect(plan.skipped).toEqual([{ security: XIU, reason: 'no_key' }]);
  });

  it('skips prices fetched recently and puts the stalest first', () => {
    const lastFetched = new Map([
      [XIU.instrumentKey, NOW - 2 * 60 * 60 * 1000],
      [ZAG.instrumentKey, NOW - 3 * DAY_MS],
    ]);
    const plan = planPriceUpdates({ ...base, lastFetched, securities: [XIU, ZAG, AAPL], apiKeys: { alphavantage: 'k' } });
    expect(plan.tasks.map((t) => t.security.symbol)).toEqual(['AAPL', 'ZAG']);
    expect(plan.skipped).toEqual([{ security: XIU, reason: 'recent' }]);
  });

  it('stays within the daily limit', () => {
    const plan = planPriceUpdates({
      ...base,
      usedToday: new Map([['alphavantage', 24]]),
      securities: [XIU, ZAG],
      apiKeys: { alphavantage: 'k' },
    });
    expect(plan.tasks).toHaveLength(1);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['limit']);
  });
});

describe('runPriceUpdates', () => {
  function deps(responses: Record<string, unknown>) {
    const saved: CachedPrice[] = [];
    const log: { outcome: string; instrumentKey?: string }[] = [];
    const fetchFn = ((url: string) => {
      const key = Object.keys(responses).find((k) => url.includes(k));
      return Promise.resolve(new Response(JSON.stringify(key ? responses[key] : {}), { status: 200 }));
    }) as unknown as typeof fetch;
    return {
      saved,
      log,
      deps: {
        apiKeys: { alphavantage: 'k', finnhub: 'f' },
        savePrices: (prices: CachedPrice[]) => Promise.resolve(saved.push(...prices)),
        logFetch: (entry: { outcome: string; instrumentKey?: string }) => Promise.resolve(log.push(entry)),
        fetchFn,
        sleep: () => Promise.resolve(),
      },
    };
  }

  it('saves every daily close in the security currency and logs success', async () => {
    const { saved, log, deps: d } = deps({
      'XIU.TRT': { 'Time Series (Daily)': { '2026-11-02': { '4. close': '54.0700' }, '2026-10-30': { '4. close': '53.91' } } },
    });
    const result = await runPriceUpdates([{ security: XIU, providerId: 'alphavantage', symbol: 'XIU.TRT' }], d);
    expect(result.updated).toBe(1);
    expect(saved.map((p) => [p.priceDate, p.close, p.currency, p.instrumentKey])).toEqual([
      ['2026-10-30', '53.91', 'CAD', 'XTSE:XIU'],
      ['2026-11-02', '54.0700', 'CAD', 'XTSE:XIU'],
    ]);
    expect(log).toMatchObject([{ outcome: 'ok', instrumentKey: 'XTSE:XIU' }]);
  });

  it('stops asking a provider once it reports its limit, but carries on with others', async () => {
    const limit = { Information: 'rate limit is 25 requests per day' };
    const { log, deps: d } = deps({ 'XIU.TRT': limit, 'ZAG.TRT': limit, 'symbol=AAPL': { c: 230.1, t: NOW / 1000 } });
    const result = await runPriceUpdates(
      [
        { security: XIU, providerId: 'alphavantage', symbol: 'XIU.TRT' },
        { security: ZAG, providerId: 'alphavantage', symbol: 'ZAG.TRT' },
        { security: AAPL, providerId: 'finnhub', symbol: 'AAPL' },
      ],
      d,
    );
    expect(result.stopped.map((s) => s.providerId)).toEqual(['alphavantage']);
    expect(result.updated).toBe(1);
    expect(log.map((l) => l.outcome)).toEqual(['rate_limited', 'ok']);
  });

  it('reports an unknown symbol as a failure for that holding only', async () => {
    const { deps: d } = deps({ 'XIU.TRT': { 'Error Message': 'Invalid API call.' } });
    const result = await runPriceUpdates([{ security: XIU, providerId: 'alphavantage', symbol: 'XIU.TRT' }], d);
    expect(result.failures).toHaveLength(1);
    expect(result.stopped).toEqual([]);
  });
});
