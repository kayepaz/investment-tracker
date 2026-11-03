import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  alphaVantage,
  finnhub,
  newYorkDate,
  numberToDecimal,
  parseAlphaVantageDaily,
  parseFinnhubQuote,
} from './providers';

function fakeFetch(status: number, body: unknown) {
  return (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error instanceof ProviderError ? error.kind : 'other';
  }
}

describe('symbol mapping', () => {
  it('maps exchanges to Alpha Vantage symbols', () => {
    expect(alphaVantage.symbolFor({ exchange: 'XTSE', symbol: 'XIU' })).toBe('XIU.TRT');
    expect(alphaVantage.symbolFor({ exchange: 'XTSX', symbol: 'ABC' })).toBe('ABC.TRV');
    expect(alphaVantage.symbolFor({ exchange: 'XNAS', symbol: 'AAPL' })).toBe('AAPL');
    expect(alphaVantage.symbolFor({ exchange: 'NEOE', symbol: 'X' })).toBeNull();
    expect(alphaVantage.symbolFor({ exchange: null, symbol: null })).toBeNull();
  });

  it('uses Finnhub for US listings only', () => {
    expect(finnhub.symbolFor({ exchange: 'XNYS', symbol: 'KO' })).toBe('KO');
    expect(finnhub.symbolFor({ exchange: 'XTSE', symbol: 'XIU' })).toBeNull();
  });
});

describe('Alpha Vantage', () => {
  it('reads daily closes oldest first, keeping exact decimals', () => {
    const body = {
      'Time Series (Daily)': {
        '2026-11-02': { '4. close': '54.0700' },
        '2026-10-30': { '4. close': '53.9100' },
        'bad-date': { '4. close': '1' },
      },
    };
    expect(parseAlphaVantageDaily(body)).toEqual([
      { date: '2026-10-30', close: '53.9100' },
      { date: '2026-11-02', close: '54.0700' },
    ]);
  });

  it('classifies limits, bad keys and unknown symbols', async () => {
    expect(await kindOf(alphaVantage.fetchDaily('X', 'k', fakeFetch(200, { Information: 'standard API rate limit is 25 requests per day' })))).toBe('rate_limited');
    expect(await kindOf(alphaVantage.fetchDaily('X', 'k', fakeFetch(200, { Note: 'Thank you for using Alpha Vantage' })))).toBe('rate_limited');
    expect(await kindOf(alphaVantage.fetchDaily('X', 'k', fakeFetch(200, { 'Error Message': 'the parameter apikey is invalid or missing' })))).toBe('bad_key');
    expect(await kindOf(alphaVantage.fetchDaily('X', 'k', fakeFetch(200, { 'Error Message': 'Invalid API call.' })))).toBe('not_found');
    expect(await kindOf(alphaVantage.fetchDaily('X', 'k', fakeFetch(500, {})))).toBe('error');
    const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(await kindOf(alphaVantage.fetchDaily('X', 'k', offline))).toBe('blocked');
  });
});

describe('Finnhub', () => {
  it('reads the latest quote as a daily close dated in New York', () => {
    // 2026-11-02 21:00 UTC is 16:00 in New York.
    expect(parseFinnhubQuote({ c: 338.32, t: Date.UTC(2026, 10, 2, 21) / 1000 })).toEqual([{ date: '2026-11-02', close: '338.32' }]);
  });

  it('classifies unknown symbols and key problems', async () => {
    expect(await kindOf(finnhub.fetchDaily('X', 'k', fakeFetch(200, { c: 0, t: 0 })))).toBe('not_found');
    expect(await kindOf(finnhub.fetchDaily('X', 'k', fakeFetch(401, { error: 'Invalid API key' })))).toBe('bad_key');
    expect(await kindOf(finnhub.fetchDaily('X', 'k', fakeFetch(429, {})))).toBe('rate_limited');
    expect(await kindOf(finnhub.fetchDaily('X', 'k', fakeFetch(403, {})))).toBe('not_found');
  });
});

describe('helpers', () => {
  it('converts API numbers to canonical decimals', () => {
    expect(numberToDecimal(338.32)).toBe('338.32');
    expect(numberToDecimal(0.1 + 0.2)).toBe('0.3');
    expect(numberToDecimal(100)).toBe('100');
    expect(numberToDecimal(-1)).toBeNull();
    expect(numberToDecimal(Number.NaN)).toBeNull();
  });

  it('dates a timestamp in New York time', () => {
    // 2026-11-03 02:00 UTC is still Nov 2 in New York.
    expect(newYorkDate(Date.UTC(2026, 10, 3, 2) / 1000)).toBe('2026-11-02');
  });
});
