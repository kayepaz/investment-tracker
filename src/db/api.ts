// The operations the page can ask the database worker to perform. Each takes the open
// connections first; the worker supplies them. Arguments and results must be plain data
// (strings, numbers, arrays, objects), since they cross between threads.

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
  type HoldingAssignment,
  type ManualPrice,
} from './bucketsRepo';
import {
  lastPriceFetches,
  lastSuccessfulFetch,
  latestDailyPrices,
  latestFxRates,
  logFetch,
  requestsSince,
  saveFxRates,
  savePrices,
  type CachedPrice,
  type FetchOutcome,
  type FxRate,
} from './cacheRepo';
import type { SqlConnection } from './migrate';
import {
  createRule,
  createTag,
  deleteRule,
  deleteTag,
  latestWarningResponses,
  listRules,
  listSecurityTags,
  listTags,
  renameTag,
  respondToWarning,
  setRuleEnabled,
  setSecurityTags,
  unhideWarning,
  updateRule,
  type RuleInput,
} from './rulesRepo';
import {
  addTransaction,
  createAccount,
  deleteApiKey,
  deleteTransaction,
  getApiKeys,
  setApiKey,
  findOrCreateSecurity,
  getAccount,
  getSetting,
  listAccountTransactions,
  listAccounts,
  listSecurities,
  setSetting,
  type NewAccount,
  type NewSecurity,
  type NewTransaction,
} from './repo';

/** The two databases: the user's data, and the rebuildable market cache. */
export type Connections = { user: SqlConnection; cache: SqlConnection };

export const api = {
  // Settings
  getSetting: (c: Connections, key: string) => getSetting(c.user, key),
  setSetting: (c: Connections, key: string, value: string) => setSetting(c.user, key, value, Date.now()),
  getApiKeys: (c: Connections) => getApiKeys(c.user),
  setApiKey: (c: Connections, providerId: string, apiKey: string) => setApiKey(c.user, providerId, apiKey, Date.now()),
  deleteApiKey: (c: Connections, providerId: string) => deleteApiKey(c.user, providerId),

  // Accounts, securities, transactions
  listAccounts: (c: Connections) => listAccounts(c.user),
  getAccount: (c: Connections, id: string) => getAccount(c.user, id),
  createAccount: (c: Connections, input: NewAccount) => createAccount(c.user, input, Date.now()),
  listSecurities: (c: Connections) => listSecurities(c.user),
  findOrCreateSecurity: (c: Connections, input: NewSecurity) => findOrCreateSecurity(c.user, input, Date.now()),
  listAccountTransactions: (c: Connections, accountId: string) => listAccountTransactions(c.user, accountId),
  listAllTransactions: (c: Connections) => listAllTransactions(c.user),
  addTransaction: (c: Connections, input: NewTransaction) => addTransaction(c.user, input, Date.now()),
  deleteTransaction: (c: Connections, id: string) => deleteTransaction(c.user, id),

  // Buckets and prices
  listBuckets: (c: Connections) => listBuckets(c.user, Date.now()),
  createBucket: (c: Connections, input: { name: string; parentId: string | null }) => createBucket(c.user, input, Date.now()),
  renameBucket: (c: Connections, id: string, name: string) => renameBucket(c.user, id, name, Date.now()),
  moveBucket: (c: Connections, id: string, parentId: string | null) => moveBucket(c.user, id, parentId, Date.now()),
  deleteBucket: (c: Connections, id: string) => deleteBucket(c.user, id),
  listAssignments: (c: Connections) => listAssignments(c.user),
  assignHolding: (c: Connections, input: HoldingAssignment) => assignHolding(c.user, input, Date.now()),
  setManualPrice: (c: Connections, input: ManualPrice & { note?: string }) => setManualPrice(c.user, input, Date.now()),
  latestManualPrices: (c: Connections) => latestManualPrices(c.user),

  // Tags, rules and warnings
  listTags: (c: Connections) => listTags(c.user, Date.now()),
  createTag: (c: Connections, name: string) => createTag(c.user, name, Date.now()),
  renameTag: (c: Connections, id: string, name: string) => renameTag(c.user, id, name),
  deleteTag: (c: Connections, id: string) => deleteTag(c.user, id),
  listSecurityTags: (c: Connections) => listSecurityTags(c.user),
  setSecurityTags: (c: Connections, securityId: string, tagIds: string[]) => setSecurityTags(c.user, securityId, tagIds),
  listRules: (c: Connections) => listRules(c.user),
  createRule: (c: Connections, input: RuleInput) => createRule(c.user, input, Date.now()),
  updateRule: (c: Connections, id: string, input: RuleInput) => updateRule(c.user, id, input, Date.now()),
  setRuleEnabled: (c: Connections, id: string, enabled: boolean) => setRuleEnabled(c.user, id, enabled, Date.now()),
  deleteRule: (c: Connections, id: string) => deleteRule(c.user, id),
  respondToWarning: (
    c: Connections,
    input: { warningKey: string; response: 'acknowledged' | 'snoozed'; note?: string; snoozeUntil?: string; today: string },
  ) => respondToWarning(c.user, input, Date.now()),
  unhideWarning: (c: Connections, warningKey: string, today: string) => unhideWarning(c.user, warningKey, today, Date.now()),
  latestWarningResponses: (c: Connections) => latestWarningResponses(c.user),

  // Market cache
  saveFxRates: (c: Connections, rates: FxRate[], providerId: string) => saveFxRates(c.cache, rates, providerId, Date.now()),
  latestFxRates: (c: Connections) => latestFxRates(c.cache),
  logFetch: (
    c: Connections,
    entry: { providerId: string; requestKind: string; instrumentKey?: string; outcome: FetchOutcome; detail?: string },
  ) => logFetch(c.cache, entry, Date.now()),
  lastSuccessfulFetch: (c: Connections, providerId: string, requestKind: string) =>
    lastSuccessfulFetch(c.cache, providerId, requestKind),
  savePrices: (c: Connections, prices: CachedPrice[]) => savePrices(c.cache, prices, Date.now()),
  latestDailyPrices: (c: Connections) => latestDailyPrices(c.cache),
  requestsSince: (c: Connections, providerId: string, since: number) => requestsSince(c.cache, providerId, since),
  lastPriceFetches: (c: Connections) => lastPriceFetches(c.cache),
};

export type Api = typeof api;
export type ApiMethod = keyof Api;
type Rest<T> = T extends (c: Connections, ...args: infer A) => unknown ? A : never;
export type ApiArgs<M extends ApiMethod> = Rest<Api[M]>;
export type ApiResult<M extends ApiMethod> = ReturnType<Api[M]>;
