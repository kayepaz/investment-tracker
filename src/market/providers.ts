// Price providers. Each user brings their own free API key. Both providers here allow requests
// straight from the browser (tested 2026-11-02); EODHD does not, so it isn't offered.

import { isDecimalString } from '../db/conventions';

export type PriceProviderId = 'alphavantage' | 'finnhub';

export type ProviderErrorKind = 'rate_limited' | 'not_found' | 'bad_key' | 'blocked' | 'error';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type DailyClose = { date: string; close: string };

export type ListedSecurity = { exchange: string | null; symbol: string | null };

export type PriceProvider = {
  id: PriceProviderId;
  name: string;
  signupUrl: string;
  /** Requests allowed per 24 hours on the free plan, or null when only a per-minute limit applies. */
  dailyLimit: number | null;
  /** Wait at least this long between requests. */
  minIntervalMs: number;
  note: string;
  /** The provider's symbol for a security, or null when the provider doesn't cover it. */
  symbolFor(security: ListedSecurity): string | null;
  /** Recent daily closes, newest last. Throws ProviderError. */
  fetchDaily(symbol: string, apiKey: string, fetchFn?: typeof fetch): Promise<DailyClose[]>;
};

const US_EXCHANGES = new Set(['XNYS', 'XNAS', 'ARCX', 'BATS']);

async function getJson(url: string, fetchFn: typeof fetch): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchFn(url, { cache: 'no-store' });
  } catch {
    throw new ProviderError('blocked', 'The request didn’t get an answer (offline, or blocked by the browser or a content blocker).');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

// ---------------------------------------------------------------------------------------------
// Alpha Vantage: TSX, TSX Venture and US listings. Free plan: 25 requests a day; the daily
// series returns the latest 100 trading days.

const AV_SUFFIX: Record<string, string> = { XTSE: '.TRT', XTSX: '.TRV' };

export function parseAlphaVantageDaily(body: unknown): DailyClose[] {
  const obj = (body ?? {}) as Record<string, unknown>;
  const series = obj['Time Series (Daily)'];
  if (!series || typeof series !== 'object') {
    const error = obj['Error Message'];
    if (typeof error === 'string') {
      throw /apikey/i.test(error)
        ? new ProviderError('bad_key', 'Alpha Vantage didn’t accept the API key.')
        : new ProviderError('not_found', 'Alpha Vantage doesn’t recognise this symbol.');
    }
    const notice = obj['Note'] ?? obj['Information'];
    if (typeof notice === 'string') {
      throw new ProviderError('rate_limited', 'Alpha Vantage’s free daily limit has been reached; prices will update tomorrow.');
    }
    throw new ProviderError('error', 'Alpha Vantage sent an unexpected answer.');
  }
  return Object.entries(series as Record<string, Record<string, unknown>>)
    .map(([date, values]) => ({ date, close: String(values['4. close'] ?? '').trim() }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && isDecimalString(d.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const alphaVantage: PriceProvider = {
  id: 'alphavantage',
  name: 'Alpha Vantage',
  signupUrl: 'https://www.alphavantage.co/support/#api-key',
  dailyLimit: 25,
  minIntervalMs: 1500,
  note: 'Covers TSX, TSX Venture and US listings. Free plan: 25 requests a day, about one per holding per day.',
  symbolFor({ exchange, symbol }) {
    if (!exchange || !symbol) return null;
    if (US_EXCHANGES.has(exchange)) return symbol;
    const suffix = AV_SUFFIX[exchange];
    return suffix ? `${symbol}${suffix}` : null;
  },
  async fetchDaily(symbol, apiKey, fetchFn = fetch) {
    const params = new URLSearchParams({ function: 'TIME_SERIES_DAILY', symbol, apikey: apiKey });
    const { status, body } = await getJson(`https://www.alphavantage.co/query?${params.toString()}`, fetchFn);
    if (status === 429) throw new ProviderError('rate_limited', 'Alpha Vantage asked us to slow down.');
    if (status >= 400) throw new ProviderError('error', `Alpha Vantage answered HTTP ${status}.`);
    const closes = parseAlphaVantageDaily(body);
    if (closes.length === 0) throw new ProviderError('not_found', 'Alpha Vantage returned no prices for this symbol.');
    return closes;
  },
};

// ---------------------------------------------------------------------------------------------
// Finnhub: US listings only on the free plan; 60 requests a minute. Gives the latest quote.

/** The calendar date of a Unix time in New York, where US markets trade. */
export function newYorkDate(unixSeconds: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A JavaScript number from an API as a canonical decimal string (prices have at most a few decimals). */
export function numberToDecimal(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const text = value.toFixed(6).replace(/\.?0+$/, '');
  return isDecimalString(text) ? text : null;
}

export function parseFinnhubQuote(body: unknown): DailyClose[] {
  const obj = (body ?? {}) as { c?: unknown; t?: unknown; error?: unknown };
  if (typeof obj.error === 'string') {
    throw /api key|token/i.test(obj.error)
      ? new ProviderError('bad_key', 'Finnhub didn’t accept the API key.')
      : new ProviderError('error', `Finnhub: ${obj.error}`);
  }
  if (typeof obj.c !== 'number' || typeof obj.t !== 'number') throw new ProviderError('error', 'Finnhub sent an unexpected answer.');
  if (obj.c === 0 || obj.t === 0) throw new ProviderError('not_found', 'Finnhub has no price for this symbol on the free plan.');
  const close = numberToDecimal(obj.c);
  if (!close) throw new ProviderError('error', 'Finnhub sent an unreadable price.');
  return [{ date: newYorkDate(obj.t), close }];
}

export const finnhub: PriceProvider = {
  id: 'finnhub',
  name: 'Finnhub',
  signupUrl: 'https://finnhub.io/register',
  dailyLimit: null,
  minIntervalMs: 1100,
  note: 'Optional. US listings only on the free plan. When set, US holdings use Finnhub, saving Alpha Vantage’s daily requests for Canadian ones.',
  symbolFor({ exchange, symbol }) {
    return exchange && symbol && US_EXCHANGES.has(exchange) ? symbol : null;
  },
  async fetchDaily(symbol, apiKey, fetchFn = fetch) {
    const params = new URLSearchParams({ symbol, token: apiKey });
    const { status, body } = await getJson(`https://finnhub.io/api/v1/quote?${params.toString()}`, fetchFn);
    if (status === 401) throw new ProviderError('bad_key', 'Finnhub didn’t accept the API key.');
    if (status === 403) throw new ProviderError('not_found', 'Finnhub doesn’t cover this symbol on the free plan.');
    if (status === 429) throw new ProviderError('rate_limited', 'Finnhub asked us to slow down.');
    if (status >= 400) throw new ProviderError('error', `Finnhub answered HTTP ${status}.`);
    return parseFinnhubQuote(body);
  },
};

export const PRICE_PROVIDERS: PriceProvider[] = [alphaVantage, finnhub];

export function providerById(id: string): PriceProvider | undefined {
  return PRICE_PROVIDERS.find((p) => p.id === id);
}
