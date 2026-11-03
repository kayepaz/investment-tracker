import type { MigrationResult } from './migrate';

/** Messages from the page to the database worker. */
export type WorkerRequest =
  | { type: 'open' }
  | { type: 'call'; id: number; method: string; args: unknown[] };

/** The worker's answer to 'open'. */
export type DbStatus =
  | { ok: true; sqliteVersion: string; user: MigrationResult; cache: MigrationResult }
  | { ok: false; stage: string; error: string };

/** Messages from the worker to the page. */
export type WorkerResponse =
  | { type: 'opened'; status: DbStatus }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: { name: string; message: string } };
