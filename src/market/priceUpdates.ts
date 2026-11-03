// Deciding which prices to download, and downloading them within each provider's free limits.

import type { CachedPrice, FetchOutcome } from '../db/cacheRepo';
import type { Security } from '../db/repo';
import { PRICE_PROVIDERS, ProviderError, providerById, type PriceProviderId } from './providers';

/** A price fetched successfully this recently isn't fetched again. */
export const MIN_REFETCH_MS = 20 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const PRICE_REQUEST = 'price_daily';

export type PriceTask = { security: Security; providerId: PriceProviderId; symbol: string };

export type SkipReason = 'not_listed' | 'not_covered' | 'no_key' | 'recent' | 'limit';

export type PricePlan = {
  tasks: PriceTask[];
  skipped: { security: Security; reason: SkipReason }[];
};

export type PlanInputs = {
  /** Securities with an open position. */
  securities: Security[];
  apiKeys: Record<string, string>;
  /** Last successful price fetch per instrument key. */
  lastFetched: Map<string, number>;
  /** Requests made to each provider in the last 24 hours. */
  usedToday: Map<string, number>;
  now: number;
};

/**
 * Picks which securities to update and with which provider. Finnhub is preferred for US listings
 * when its key is set, saving Alpha Vantage's 25 daily requests for Canadian listings. The ones
 * fetched longest ago (or never) go first, so a portfolio larger than the limit rotates daily.
 */
export function planPriceUpdates(inputs: PlanInputs): PricePlan {
  const tasks: PriceTask[] = [];
  const skipped: PricePlan['skipped'] = [];
  const remaining = new Map<string, number>();
  for (const provider of PRICE_PROVIDERS) {
    if (provider.dailyLimit !== null) {
      remaining.set(provider.id, Math.max(0, provider.dailyLimit - (inputs.usedToday.get(provider.id) ?? 0)));
    }
  }

  const candidates = inputs.securities
    .filter((s) => s.kind !== 'cash')
    .sort((a, b) => (inputs.lastFetched.get(a.instrumentKey) ?? 0) - (inputs.lastFetched.get(b.instrumentKey) ?? 0));

  for (const security of candidates) {
    if (!security.exchange || !security.symbol) {
      skipped.push({ security, reason: 'not_listed' });
      continue;
    }
    const last = inputs.lastFetched.get(security.instrumentKey);
    if (last !== undefined && inputs.now - last < MIN_REFETCH_MS) {
      skipped.push({ security, reason: 'recent' });
      continue;
    }
    // Providers that cover this listing, in order of preference.
    const covering = ['finnhub', 'alphavantage']
      .map((id) => providerById(id)!)
      .map((provider) => ({ provider, symbol: provider.symbolFor(security) }))
      .filter((c): c is { provider: (typeof PRICE_PROVIDERS)[number]; symbol: string } => c.symbol !== null);
    if (covering.length === 0) {
      skipped.push({ security, reason: 'not_covered' });
      continue;
    }
    const keyed = covering.filter((c) => inputs.apiKeys[c.provider.id]);
    if (keyed.length === 0) {
      skipped.push({ security, reason: 'no_key' });
      continue;
    }
    const usable = keyed.find((c) => !remaining.has(c.provider.id) || remaining.get(c.provider.id)! > 0);
    if (!usable) {
      skipped.push({ security, reason: 'limit' });
      continue;
    }
    if (remaining.has(usable.provider.id)) remaining.set(usable.provider.id, remaining.get(usable.provider.id)! - 1);
    tasks.push({ security, providerId: usable.provider.id, symbol: usable.symbol });
  }
  return { tasks, skipped };
}

export type PriceUpdateDeps = {
  apiKeys: Record<string, string>;
  savePrices: (prices: CachedPrice[]) => Promise<unknown>;
  logFetch: (entry: { providerId: string; requestKind: string; instrumentKey?: string; outcome: FetchOutcome; detail?: string }) => Promise<unknown>;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
};

export type PriceUpdateResult = {
  updated: number;
  failures: { security: Security; message: string }[];
  /** Providers that refused further requests this time (daily limit reached or key rejected). */
  stopped: { providerId: string; message: string }[];
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const OUTCOME: Record<ProviderError['kind'], FetchOutcome> = {
  rate_limited: 'rate_limited',
  blocked: 'blocked',
  not_found: 'error',
  bad_key: 'error',
  error: 'error',
};

/** Downloads the planned prices one at a time, pacing requests and stopping a provider that refuses. */
export async function runPriceUpdates(tasks: PriceTask[], deps: PriceUpdateDeps): Promise<PriceUpdateResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const lastRequest = new Map<string, number>();
  const result: PriceUpdateResult = { updated: 0, failures: [], stopped: [] };
  const stopped = new Set<string>();

  for (const [index, task] of tasks.entries()) {
    deps.onProgress?.(index, tasks.length);
    if (stopped.has(task.providerId)) continue;
    const provider = providerById(task.providerId)!;
    const wait = (lastRequest.get(provider.id) ?? 0) + provider.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest.set(provider.id, Date.now());

    const instrumentKey = task.security.instrumentKey;
    try {
      const closes = await provider.fetchDaily(task.symbol, deps.apiKeys[provider.id] ?? '', deps.fetchFn);
      await deps.savePrices(
        closes.map((c) => ({
          instrumentKey,
          interval: '1d' as const,
          priceDate: c.date,
          close: c.close,
          currency: task.security.currency,
          providerId: provider.id,
        })),
      );
      await deps.logFetch({ providerId: provider.id, requestKind: PRICE_REQUEST, instrumentKey, outcome: 'ok' });
      result.updated += 1;
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : 'error';
      const message = error instanceof Error ? error.message : String(error);
      await deps.logFetch({ providerId: provider.id, requestKind: PRICE_REQUEST, instrumentKey, outcome: OUTCOME[kind], detail: message });
      if (kind === 'rate_limited' || kind === 'bad_key' || kind === 'blocked') {
        stopped.add(provider.id);
        result.stopped.push({ providerId: provider.id, message });
      } else {
        result.failures.push({ security: task.security, message });
      }
    }
  }
  deps.onProgress?.(tasks.length, tasks.length);
  return result;
}
