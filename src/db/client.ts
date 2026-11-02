import type { DbStatus, WorkerRequest } from './protocol';

let worker: Worker | null = null;
let status: Promise<DbStatus> | null = null;

/** Starts the database worker (once per page) and resolves when both databases are open and migrated. */
export function openDatabases(timeoutMs = 30_000): Promise<DbStatus> {
  status ??= new Promise<DbStatus>((resolve) => {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(
      () => resolve({ ok: false, stage: 'start', error: `No answer after ${timeoutMs / 1000} seconds` }),
      timeoutMs,
    );
    worker.onmessage = (event: MessageEvent<DbStatus>) => {
      window.clearTimeout(timer);
      resolve(event.data);
    };
    worker.onerror = (event) => {
      window.clearTimeout(timer);
      resolve({ ok: false, stage: 'start', error: event.message || 'The database worker failed to start' });
    };
    const request: WorkerRequest = { type: 'open' };
    worker.postMessage(request);
  });
  return status;
}

/** Asks the browser not to clear this site's storage under pressure. Returns whether it agreed. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator.storage?.persist !== 'function') return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
