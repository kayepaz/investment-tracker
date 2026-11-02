import type { ProviderResult } from './types';

export const BANK_OF_CANADA_USDCAD_URL =
  'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';

/** A price provider under test: how to call it and how to read its answer. */
export type PriceProvider = {
  id: string;
  name: string;
  signupUrl: string;
  defaultSymbol: string;
  note: string;
  url: (symbol: string, apiKey: string) => string;
  parse: (symbol: string, json: unknown) => ProviderResult;
};

function bad(detail: string): ProviderResult {
  return { ok: false, kind: 'bad-response', detail };
}

function preview(json: unknown): string {
  return JSON.stringify(json)?.slice(0, 160) ?? String(json);
}

/** Reads the latest USD/CAD observation from a Bank of Canada Valet response. */
export function parseBankOfCanada(json: unknown): ProviderResult {
  const observations = (json as { observations?: unknown })?.observations;
  if (!Array.isArray(observations) || observations.length === 0) {
    return bad('No observations in response');
  }
  const latest = observations[observations.length - 1] as { d?: unknown; FXUSDCAD?: { v?: unknown } };
  const date = latest.d;
  const value = latest.FXUSDCAD?.v;
  if (typeof date !== 'string' || typeof value !== 'string') {
    return bad('Unexpected observation format');
  }
  return { ok: true, summary: `USD/CAD ${value} on ${date}` };
}

/** EODHD `filter=last_close` returns a bare number. */
export function parseEodhdLastClose(symbol: string, json: unknown): ProviderResult {
  const value = typeof json === 'number' ? json : typeof json === 'string' ? Number(json) : NaN;
  if (!Number.isFinite(value)) {
    return bad(`Unexpected response: ${preview(json)}`);
  }
  return { ok: true, summary: `${symbol} last close ${value}` };
}

/** Alpha Vantage TIME_SERIES_DAILY. Errors and rate limits come back as 200 with a message key. */
export function parseAlphaVantageDaily(symbol: string, json: unknown): ProviderResult {
  const obj = (json ?? {}) as Record<string, unknown>;
  const series = obj['Time Series (Daily)'];
  if (!series || typeof series !== 'object') {
    const message = obj['Error Message'] ?? obj['Note'] ?? obj['Information'];
    return bad(typeof message === 'string' ? message : `Unexpected response: ${preview(json)}`);
  }
  const dates = Object.keys(series).sort();
  const latestDate = dates[dates.length - 1];
  if (!latestDate) return bad('Empty time series');
  const close = (series as Record<string, Record<string, string>>)[latestDate]?.['4. close'];
  if (close === undefined) return bad('Missing close price');
  return { ok: true, summary: `${symbol} close ${close} on ${latestDate}; ${dates.length} days of history returned` };
}

/** FMP stable quote: an array of quotes, or an error object/string. */
export function parseFmpQuote(symbol: string, json: unknown): ProviderResult {
  if (Array.isArray(json)) {
    const quote = json[0] as { price?: unknown } | undefined;
    if (!quote) return bad(`No quote returned for ${symbol} (may not be covered by your plan)`);
    if (typeof quote.price !== 'number') return bad(`Unexpected quote: ${preview(quote)}`);
    return { ok: true, summary: `${symbol} price ${quote.price}` };
  }
  const message = (json as Record<string, unknown> | null)?.['Error Message'];
  return bad(typeof message === 'string' ? message : `Unexpected response: ${preview(json)}`);
}

/** Finnhub quote: `c` is the current price; 0 means the symbol is unknown or not covered. */
export function parseFinnhubQuote(symbol: string, json: unknown): ProviderResult {
  const obj = (json ?? {}) as { c?: unknown; error?: unknown };
  if (typeof obj.error === 'string') return bad(obj.error);
  if (typeof obj.c !== 'number') return bad(`Unexpected response: ${preview(json)}`);
  if (obj.c === 0) return bad(`No price for ${symbol} (not covered by your plan or unknown symbol)`);
  return { ok: true, summary: `${symbol} price ${obj.c}` };
}

export const PRICE_PROVIDERS: PriceProvider[] = [
  {
    id: 'eodhd',
    name: 'EODHD',
    signupUrl: 'https://eodhd.com/register',
    defaultSymbol: 'XIU.TO',
    note: 'Already known to be blocked in browsers; kept for comparison.',
    url: (symbol, key) =>
      `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?${new URLSearchParams({ api_token: key, fmt: 'json', filter: 'last_close' })}`,
    parse: parseEodhdLastClose,
  },
  {
    id: 'alphavantage',
    name: 'Alpha Vantage',
    signupUrl: 'https://www.alphavantage.co/support/#api-key',
    defaultSymbol: 'XIU.TRT',
    note: 'Toronto symbols end in .TRT. Free plan: 25 requests a day.',
    url: (symbol, key) =>
      `https://www.alphavantage.co/query?${new URLSearchParams({ function: 'TIME_SERIES_DAILY', symbol, apikey: key })}`,
    parse: parseAlphaVantageDaily,
  },
  {
    id: 'fmp',
    name: 'Financial Modeling Prep',
    signupUrl: 'https://site.financialmodelingprep.com/register',
    defaultSymbol: 'XIU.TO',
    note: 'Free plan: 250 requests a day. TSX coverage on the free plan is what we are testing.',
    url: (symbol, key) =>
      `https://financialmodelingprep.com/stable/quote?${new URLSearchParams({ symbol, apikey: key })}`,
    parse: parseFmpQuote,
  },
  {
    id: 'finnhub',
    name: 'Finnhub',
    signupUrl: 'https://finnhub.io/register',
    defaultSymbol: 'AAPL',
    note: 'Free plan is US-only, so this tests a US symbol: a possible source for US holdings.',
    url: (symbol, key) => `https://finnhub.io/api/v1/quote?${new URLSearchParams({ symbol, token: key })}`,
    parse: parseFinnhubQuote,
  },
];

/**
 * Fetches a URL and parses it. A network-level failure (the browser refusing the request,
 * typically CORS or a content blocker such as Brave Shields) is reported as "blocked".
 */
export async function fetchAndParse(
  url: string,
  parse: (json: unknown) => ProviderResult,
  fetchFn: typeof fetch = fetch,
): Promise<ProviderResult> {
  let response: Response;
  try {
    response = await fetchFn(url, { cache: 'no-store' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'blocked', detail: `Request blocked by the browser (${message})` };
  }
  if (!response.ok) {
    return { ok: false, kind: 'http', detail: `HTTP ${response.status} ${response.statusText}`.trim() };
  }
  try {
    return parse(await response.json());
  } catch {
    return bad('Response was not valid JSON');
  }
}

/** Describes a provider result in one line for the copyable report. Never includes the API key. */
export function describeResult(result: ProviderResult | null): string {
  if (!result) return 'not run';
  return result.ok ? `OK: ${result.summary}` : `FAILED (${result.kind}): ${result.detail}`;
}
