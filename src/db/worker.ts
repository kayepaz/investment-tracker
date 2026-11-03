// Database worker: owns both SQLite databases for the life of the page.
//
// Storage: sqlite-wasm's "opfs-sahpool" backend keeps the files in the browser's Origin Private
// File System. It needs no cross-origin isolation headers (GitHub Pages can't send them), but it
// must run in a worker, and only one tab can hold the pool at a time.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { migrate, type MigrationResult, type SqlConnection, type SqlValue } from './migrate';
import { CACHE_MIGRATIONS } from './migrations/cache';
import { USER_MIGRATIONS } from './migrations/user';
import { api, type ApiMethod } from './api';
import type { DbStatus, WorkerRequest, WorkerResponse } from './protocol';

export const POOL_NAME = 'investment-tracker';
export const USER_DB_FILE = '/user.sqlite3';
export const CACHE_DB_FILE = '/cache.sqlite3';

type Oo1Db = {
  exec(
    sql: string | { sql: string; bind?: SqlValue[]; rowMode?: 'object'; returnValue?: 'resultRows' },
  ): unknown;
  selectValue(sql: string): unknown;
  close(): void;
};

type SahPool = {
  OpfsSAHPoolDb: new (filename: string) => Oo1Db;
  removeVfs?: () => Promise<boolean>;
};

type WorkerScope = {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
const scope = self as unknown as WorkerScope;

function connection(db: Oo1Db): SqlConnection {
  return {
    execScript: (sql) => {
      db.exec(sql);
    },
    run: (sql, params) => {
      db.exec(params.length > 0 ? { sql, bind: params } : sql);
    },
    queryValue: (sql) => db.selectValue(sql) ?? null,
    all: (sql, params = []) =>
      db.exec(
        params.length > 0
          ? { sql, bind: params, rowMode: 'object', returnValue: 'resultRows' }
          : { sql, rowMode: 'object', returnValue: 'resultRows' },
      ) as Record<string, SqlValue>[],
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

let userDb: Oo1Db | null = null;
let cacheDb: Oo1Db | null = null;
let opening: Promise<DbStatus> | null = null;

/** Removes the storage used by the temporary technical test page (PR #3/#4). Best effort. */
async function removeSpikeStorage(sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>): Promise<void> {
  try {
    const spike = (await sqlite3.installOpfsSAHPoolVfs({ name: 'investment-tracker-spike' })) as unknown as SahPool;
    await spike.removeVfs?.();
  } catch {
    // Nothing to clean up, or not supported; harmless either way.
  }
}

async function open(): Promise<DbStatus> {
  let stage = 'load SQLite';
  try {
    const sqlite3 = await sqlite3InitModule();
    stage = 'open on-device storage';
    const pool = (await sqlite3.installOpfsSAHPoolVfs({ name: POOL_NAME })) as unknown as SahPool;

    stage = 'open your data';
    userDb ??= new pool.OpfsSAHPoolDb(USER_DB_FILE);
    const user: MigrationResult = migrate(connection(userDb), 'user', USER_MIGRATIONS);

    stage = 'open the market cache';
    cacheDb ??= new pool.OpfsSAHPoolDb(CACHE_DB_FILE);
    const cache: MigrationResult = migrate(connection(cacheDb), 'cache', CACHE_MIGRATIONS);

    void removeSpikeStorage(sqlite3);
    return { ok: true, sqliteVersion: sqlite3.version.libVersion, user, cache };
  } catch (error) {
    return { ok: false, stage, error: errorText(error) };
  }
}

async function call(id: number, method: string, args: unknown[]): Promise<WorkerResponse> {
  try {
    opening ??= open();
    const status = await opening;
    if (!status.ok || !userDb) throw new Error(`Storage is not available: ${status.ok ? 'not open' : status.error}`);
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`Unknown operation ${method}`);
    const fn = api[method as ApiMethod] as (db: SqlConnection, ...rest: unknown[]) => unknown;
    return { type: 'result', id, ok: true, value: fn(connection(userDb), ...args) };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { type: 'result', id, ok: false, error: { name: err.name, message: err.message } };
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'open') {
    opening ??= open();
    void opening.then((status) => scope.postMessage({ type: 'opened', status }));
  } else if (request.type === 'call') {
    void call(request.id, request.method, request.args).then((response) => scope.postMessage(response));
  }
};
