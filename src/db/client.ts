import type { ApiArgs, ApiMethod, ApiResult } from './api';
import type { DbStatus, WorkerRequest, WorkerResponse } from './protocol';

/** An error from the database worker; ValidationError messages are meant for the user. */
export class DbError extends Error {
  constructor(
    name: string,
    message: string,
  ) {
    super(message);
    this.name = name;
  }

  get isValidation(): boolean {
    return this.name === 'ValidationError';
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let status: Promise<DbStatus> | null = null;
let resolveStatus: ((status: DbStatus) => void) | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function startWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'opened') {
      resolveStatus?.(message.status);
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.ok) waiting.resolve(message.value);
    else waiting.reject(new DbError(message.error.name, message.error.message));
  };
  worker.onerror = (event) => {
    const error = event.message || 'The database worker failed';
    resolveStatus?.({ ok: false, stage: 'start', error });
    for (const waiting of pending.values()) waiting.reject(new DbError('WorkerError', error));
    pending.clear();
  };
  return worker;
}

/** Starts the database worker (once per page) and resolves when both databases are open and migrated. */
export function openDatabases(timeoutMs = 30_000): Promise<DbStatus> {
  status ??= new Promise<DbStatus>((resolve) => {
    const timer = window.setTimeout(
      () => resolve({ ok: false, stage: 'start', error: `No answer after ${timeoutMs / 1000} seconds` }),
      timeoutMs,
    );
    resolveStatus = (result) => {
      window.clearTimeout(timer);
      resolve(result);
    };
    const request: WorkerRequest = { type: 'open' };
    startWorker().postMessage(request);
  });
  return status;
}

/** Runs one database operation in the worker. */
export function db<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<ApiResult<M>> {
  const id = nextId++;
  return new Promise<ApiResult<M>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const request: WorkerRequest = { type: 'call', id, method, args };
    startWorker().postMessage(request);
  });
}

/** Asks the browser not to clear this site's storage under pressure. Returns whether it agreed. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator.storage?.persist !== 'function') return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/** The user-facing text for an error from a database operation. */
export function errorMessage(error: unknown): string {
  if (error instanceof DbError && error.isValidation) return error.message;
  const text = error instanceof Error ? error.message : String(error);
  return `Something went wrong: ${text}`;
}
