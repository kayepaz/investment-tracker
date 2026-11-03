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
import { lastSuccessfulFetch, latestFxRates, logFetch, saveFxRates, type FetchOutcome, type FxRate } from './cacheRepo';
import type { SqlConnection } from './migrate';
import {
  addTransaction,
  createAccount,
  deleteTransaction,
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

  // Market cache
  saveFxRates: (c: Connections, rates: FxRate[], providerId: string) => saveFxRates(c.cache, rates, providerId, Date.now()),
  latestFxRates: (c: Connections) => latestFxRates(c.cache),
  logFetch: (
    c: Connections,
    entry: { providerId: string; requestKind: string; instrumentKey?: string; outcome: FetchOutcome; detail?: string },
  ) => logFetch(c.cache, entry, Date.now()),
  lastSuccessfulFetch: (c: Connections, providerId: string, requestKind: string) =>
    lastSuccessfulFetch(c.cache, providerId, requestKind),
};

export type Api = typeof api;
export type ApiMethod = keyof Api;
type Rest<T> = T extends (c: Connections, ...args: infer A) => unknown ? A : never;
export type ApiArgs<M extends ApiMethod> = Rest<Api[M]>;
export type ApiResult<M extends ApiMethod> = ReturnType<Api[M]>;
