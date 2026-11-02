import type { ProviderResult } from './types';

export const BANK_OF_CANADA_USDCAD_URL =
  'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';

export function eodhdLastCloseUrl(symbol: string, apiKey: string): string {
  const params = new URLSearchParams({ api_token: apiKey, fmt: 'json', filter: 'last_close' });
  return `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?${params.toString()}`;
}

/** Reads the latest USD/CAD observation from a Bank of Canada Valet response. */
export function parseBankOfCanada(json: unknown): ProviderResult {
  const observations = (json as { observations?: unknown })?.observations;
  if (!Array.isArray(observations) || observations.length === 0) {
    return { ok: false, kind: 'bad-response', detail: 'No observations in response' };
  }
  const latest = observations[observations.length - 1] as { d?: unknown; FXUSDCAD?: { v?: unknown } };
  const date = latest.d;
  const value = latest.FXUSDCAD?.v;
  if (typeof date !== 'string' || typeof value !== 'string') {
    return { ok: false, kind: 'bad-response', detail: 'Unexpected observation format' };
  }
  return { ok: true, summary: `USD/CAD ${value} on ${date}` };
}

/** Reads the last close from an EODHD `filter=last_close` response (a bare number). */
export function parseEodhdLastClose(symbol: string, json: unknown): ProviderResult {
  const value = typeof json === 'number' ? json : typeof json === 'string' ? Number(json) : NaN;
  if (!Number.isFinite(value)) {
    return { ok: false, kind: 'bad-response', detail: `Unexpected response: ${JSON.stringify(json).slice(0, 120)}` };
  }
  return { ok: true, summary: `${symbol} last close ${value}` };
}

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
    return { ok: false, kind: 'bad-response', detail: 'Response was not valid JSON' };
  }
}

/** Describes a provider result in one line for the copyable report. Never includes the API key. */
export function describeResult(result: ProviderResult | null): string {
  if (!result) return 'not run';
  return result.ok ? `OK: ${result.summary}` : `FAILED (${result.kind}): ${result.detail}`;
}
