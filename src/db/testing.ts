// Test helper: an in-memory SQLite database using Node's built-in node:sqlite,
// wrapped in the same SqlConnection interface the app uses with sqlite-wasm.
import { DatabaseSync } from 'node:sqlite';
import type { SqlConnection, SqlValue } from './migrate';

export type TestDb = SqlConnection & {
  raw: DatabaseSync;
  all(sql: string, params?: SqlValue[]): Record<string, unknown>[];
};

export function openTestDb(): TestDb {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    execScript: (sql) => raw.exec(sql),
    run: (sql, params) => {
      raw.prepare(sql).run(...params);
    },
    queryValue: (sql) => {
      const row = raw.prepare(sql).get() as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : null;
    },
    // node:sqlite returns null-prototype rows; copy them into plain objects for comparisons.
    all: (sql, params = []) => raw.prepare(sql).all(...params).map((row) => ({ ...row })),
  };
}
