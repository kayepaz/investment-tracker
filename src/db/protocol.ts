import type { MigrationResult } from './migrate';

/** Messages from the page to the database worker. */
export type WorkerRequest = { type: 'open' };

/** The worker's answer to 'open'. */
export type DbStatus =
  | { ok: true; sqliteVersion: string; user: MigrationResult; cache: MigrationResult }
  | { ok: false; stage: string; error: string };
