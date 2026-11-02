import { describe, expect, it } from 'vitest';
import {
  PRICE_PROVIDERS,
  describeResult,
  fetchAndParse,
  parseAlphaVantageDaily,
  parseBankOfCanada,
  parseEodhdLastClose,
  parseFinnhubQuote,
  parseFmpQuote,
} from './providers';

describe('parseBankOfCanada', () => {
  it('reads the latest observation', () => {
    const json = { observations: [{ d: '2026-10-30', FXUSDCAD: { v: '1.3912' } }] };
    expect(parseBankOfCanada(json)).toEqual({ ok: true, summary: 'USD/CAD 1.3912 on 2026-10-30' });
  });

  it('reports an empty response', () => {
    expect(parseBankOfCanada({ observations: [] })).toMatchObject({ ok: false, kind: 'bad-response' });
    expect(parseBankOfCanada(null)).toMatchObject({ ok: false, kind: 'bad-response' });
  });
});

describe('parseEodhdLastClose', () => {
  it('accepts a number or numeric string', () => {
    expect(parseEodhdLastClose('XIU.TO', 41.25)).toEqual({ ok: true, summary: 'XIU.TO last close 41.25' });
    expect(parseEodhdLastClose('XIU.TO', '41.25')).toMatchObject({ ok: true });
  });

  it('rejects anything else', () => {
    expect(parseEodhdLastClose('XIU.TO', { error: 'x' })).toMatchObject({ ok: false, kind: 'bad-response' });
  });
});

describe('parseAlphaVantageDaily', () => {
  it('reads the latest close and counts the days returned', () => {
    const json = {
      'Time Series (Daily)': {
        '2026-10-30': { '4. close': '54.07' },
        '2026-10-29': { '4. close': '53.90' },
      },
    };
    expect(parseAlphaVantageDaily('XIU.TRT', json)).toEqual({
      ok: true,
      summary: 'XIU.TRT close 54.07 on 2026-10-30; 2 days of history returned',
    });
  });

  it('surfaces rate-limit and error messages', () => {
    expect(parseAlphaVantageDaily('X', { Information: 'rate limit' })).toEqual({
      ok: false,
      kind: 'bad-response',
      detail: 'rate limit',
    });
    expect(parseAlphaVantageDaily('X', { 'Error Message': 'Invalid API call' })).toMatchObject({
      detail: 'Invalid API call',
    });
  });
});

describe('parseFmpQuote', () => {
  it('reads the price', () => {
    expect(parseFmpQuote('XIU.TO', [{ symbol: 'XIU.TO', price: 54.07 }])).toEqual({
      ok: true,
      summary: 'XIU.TO price 54.07',
    });
  });

  it('reports an empty array and error messages', () => {
    expect(parseFmpQuote('XIU.TO', [])).toMatchObject({ ok: false });
    expect(parseFmpQuote('XIU.TO', { 'Error Message': 'Restricted' })).toMatchObject({ detail: 'Restricted' });
  });
});

describe('parseFinnhubQuote', () => {
  it('reads the price and treats 0 as not covered', () => {
    expect(parseFinnhubQuote('AAPL', { c: 230.1 })).toEqual({ ok: true, summary: 'AAPL price 230.1' });
    expect(parseFinnhubQuote('XIU.TO', { c: 0 })).toMatchObject({ ok: false });
    expect(parseFinnhubQuote('AAPL', { error: 'Invalid API key' })).toMatchObject({ detail: 'Invalid API key' });
  });
});

describe('PRICE_PROVIDERS', () => {
  it('builds URLs containing the symbol and key', () => {
    for (const provider of PRICE_PROVIDERS) {
      const url = provider.url(provider.defaultSymbol, 'KEY123');
      expect(url.startsWith('https://')).toBe(true);
      expect(url).toContain('KEY123');
      expect(decodeURIComponent(url)).toContain(provider.defaultSymbol);
    }
  });

  it('has unique ids', () => {
    const ids = PRICE_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('fetchAndParse', () => {
  const parse = (json: unknown) => parseEodhdLastClose('X', json);

  it('reports a network-level failure as blocked', async () => {
    const failing = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(await fetchAndParse('https://x', parse, failing)).toMatchObject({ ok: false, kind: 'blocked' });
  });

  it('reports HTTP errors', async () => {
    const unauthorized = (() =>
      Promise.resolve(new Response('no', { status: 401, statusText: 'Unauthorized' }))) as unknown as typeof fetch;
    expect(await fetchAndParse('https://x', parse, unauthorized)).toEqual({
      ok: false,
      kind: 'http',
      detail: 'HTTP 401 Unauthorized',
    });
  });

  it('parses a successful response', async () => {
    const okFetch = (() => Promise.resolve(new Response('12.5'))) as unknown as typeof fetch;
    expect(await fetchAndParse('https://x', parse, okFetch)).toMatchObject({ ok: true });
  });
});

describe('describeResult', () => {
  it('summarizes results', () => {
    expect(describeResult(null)).toBe('not run');
    expect(describeResult({ ok: true, summary: 's' })).toBe('OK: s');
    expect(describeResult({ ok: false, kind: 'http', detail: 'd' })).toBe('FAILED (http): d');
  });
});
