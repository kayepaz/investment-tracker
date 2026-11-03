import { describe, expect, it } from 'vitest';
import { fetchLatestRates, parseValetRates } from './bankOfCanada';

const SAMPLE = {
  groupDetail: { label: 'Daily exchange rates' },
  observations: [
    {
      d: '2026-11-02',
      FXUSDCAD: { v: '1.3978' },
      FXEURCAD: { v: '1.6123' },
      FXJPYCAD: { v: '0.009312' },
      FXXXXCAD: { v: 'n/a' },
      SOMETHINGELSE: { v: '1' },
    },
  ],
};

describe('parseValetRates', () => {
  it('reads every FX<CUR>CAD series as CAD per unit', () => {
    expect(parseValetRates(SAMPLE)).toEqual([
      { base: 'USD', quote: 'CAD', rateDate: '2026-11-02', rate: '1.3978' },
      { base: 'EUR', quote: 'CAD', rateDate: '2026-11-02', rate: '1.6123' },
      { base: 'JPY', quote: 'CAD', rateDate: '2026-11-02', rate: '0.009312' },
    ]);
  });

  it('returns nothing for unexpected responses', () => {
    expect(parseValetRates(null)).toEqual([]);
    expect(parseValetRates({ observations: 'x' })).toEqual([]);
  });
});

describe('fetchLatestRates', () => {
  it('fails clearly on HTTP errors and empty answers', async () => {
    const http500 = (() => Promise.resolve(new Response('x', { status: 500 }))) as unknown as typeof fetch;
    await expect(fetchLatestRates(http500)).rejects.toThrow(/HTTP 500/);
    const empty = (() => Promise.resolve(new Response('{"observations":[]}'))) as unknown as typeof fetch;
    await expect(fetchLatestRates(empty)).rejects.toThrow(/no rates/);
  });

  it('returns parsed rates', async () => {
    const ok = (() => Promise.resolve(new Response(JSON.stringify(SAMPLE)))) as unknown as typeof fetch;
    expect(await fetchLatestRates(ok)).toHaveLength(3);
  });
});
