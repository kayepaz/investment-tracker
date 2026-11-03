// Database worker: owns both SQLite databases for the life of the page.
//
// Storage: sqlite-wasm's "opfs-sahpool" backend keeps the files in the browser's Origin Private
// File System. It needs no cross-origin isolation headers (GitHub Pages can't send them), but it
// must run in a worker, and only one tab can hold the pool at a time.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { migrate, type MigrationResult, type SqlConnection, type SqlValue } from './migrate';
import { CACHE_MIGRATIONS } from './migrations/cache';
import { USER_MIGRATIONS } from './migrations/user';
import type { DbStatus, WorkerRequest } from './protocol';

export const POOL_NAME = 'investment-tracker';
export const USER_DB_FILE = '/user.sqlite3';
export const CACHE_DB_FILE = '/cache.sqlite3';

type Oo1Db = {
  exec(sql: string | { sql: string; bind: SqlValue[] }): unknown;
  selectValue(sql: string): unknown;
  close(): void;
};

type SahPool = {
  OpfsSAHPoolDb: new (filename: string) => Oo1Db;
  removeVfs?: () => Promise<boolean>;
};

type WorkerScope = {
  postMessage(message: DbStatus): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
const scope = self as unknown as WorkerScope;

function connection(db: Oo1Db): SqlConnection {
  return {
    execScript: (sql) => {
      db.exec(sql);
    },
    run: (sql, params) => {
      db.exec({ sql, bind: params });
    },
    queryValue: (sql) => db.selectValue(sql) ?? null,
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

scope.onmessage = (event) => {
  if (event.data.type === 'open') {
    opening ??= open();
    void opening.then((status) => scope.postMessage(status));
  }
};
