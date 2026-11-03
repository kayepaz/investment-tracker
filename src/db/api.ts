// The operations the page can ask the database worker to perform on the user database.
// Each takes the connection first; the worker supplies it. Arguments and results must be plain
// data (strings, numbers, arrays, objects), since they cross between threads.

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

export const api = {
  getSetting: (db: SqlConnection, key: string) => getSetting(db, key),
  setSetting: (db: SqlConnection, key: string, value: string) => setSetting(db, key, value, Date.now()),
  listAccounts: (db: SqlConnection) => listAccounts(db),
  getAccount: (db: SqlConnection, id: string) => getAccount(db, id),
  createAccount: (db: SqlConnection, input: NewAccount) => createAccount(db, input, Date.now()),
  listSecurities: (db: SqlConnection) => listSecurities(db),
  findOrCreateSecurity: (db: SqlConnection, input: NewSecurity) => findOrCreateSecurity(db, input, Date.now()),
  listAccountTransactions: (db: SqlConnection, accountId: string) => listAccountTransactions(db, accountId),
  addTransaction: (db: SqlConnection, input: NewTransaction) => addTransaction(db, input, Date.now()),
  deleteTransaction: (db: SqlConnection, id: string) => deleteTransaction(db, id),
};

export type Api = typeof api;
export type ApiMethod = keyof Api;
type Rest<T> = T extends (db: SqlConnection, ...args: infer A) => unknown ? A : never;
export type ApiArgs<M extends ApiMethod> = Rest<Api[M]>;
export type ApiResult<M extends ApiMethod> = ReturnType<Api[M]>;
