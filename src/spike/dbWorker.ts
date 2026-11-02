// Technical spike: can this browser keep a SQLite database on the device?
//
// Uses the "opfs-sahpool" storage backend, which stores the database in the browser's
// Origin Private File System and, unlike the plain "opfs" backend, does not need special
// cross-origin isolation headers (which GitHub Pages cannot send).

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { DbTestResult } from './types';

type WorkerScope = {
  postMessage(message: DbTestResult): void;
  onmessage: ((event: MessageEvent<{ type: 'run' }>) => void) | null;
};
const scope = self as unknown as WorkerScope;

let sqlite3Promise: ReturnType<typeof sqlite3InitModule> | null = null;
let poolPromise: Promise<unknown> | null = null;

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function runTest(): Promise<DbTestResult> {
  let stage = 'load SQLite';
  let sqliteVersion: string | undefined;
  try {
    sqlite3Promise ??= sqlite3InitModule();
    const sqlite3 = await sqlite3Promise;
    sqliteVersion = sqlite3.version.libVersion;

    stage = 'open on-device storage (OPFS)';
    poolPromise ??= sqlite3.installOpfsSAHPoolVfs({ name: 'investment-tracker-spike' });
    // The pool utility's type is not exported by name, so narrow it here.
    const pool = (await poolPromise) as {
      OpfsSAHPoolDb: new (filename: string) => {
        exec(sql: string | { sql: string; bind: unknown[] }): unknown;
        selectValue(sql: string): unknown;
        close(): void;
      };
    };

    stage = 'write and read rows';
    const db = new pool.OpfsSAHPoolDb('/spike.sqlite3');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, ran_at TEXT NOT NULL)');
      db.exec({ sql: 'INSERT INTO runs (ran_at) VALUES (?)', bind: [new Date().toISOString()] });
      const rowCount = Number(db.selectValue('SELECT count(*) FROM runs'));
      const firstRunAt = String(db.selectValue('SELECT min(ran_at) FROM runs'));
      return { ok: true, sqliteVersion, storage: 'opfs-sahpool', rowCount, firstRunAt };
    } finally {
      db.close();
    }
  } catch (error) {
    // Check whether SQLite itself works, so a storage failure is not mistaken for a SQLite failure.
    let inMemoryWorks = false;
    try {
      const sqlite3 = await (sqlite3Promise ?? sqlite3InitModule());
      const memDb = new sqlite3.oo1.DB(':memory:');
      memDb.exec('SELECT 1');
      memDb.close();
      inMemoryWorks = true;
    } catch {
      inMemoryWorks = false;
    }
    return { ok: false, stage, error: errorText(error), sqliteVersion, inMemoryWorks };
  }
}

scope.onmessage = (event) => {
  if (event.data.type === 'run') {
    void runTest().then((result) => scope.postMessage(result));
  }
};
