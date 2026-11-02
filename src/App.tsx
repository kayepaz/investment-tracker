import { useEffect, useState } from 'react';
import { APP_NAME } from './appInfo';
import { openDatabases, requestPersistentStorage } from './db/client';
import type { DbStatus } from './db/protocol';

function describeStatus(status: DbStatus | null): string {
  if (!status) return 'Opening storage…';
  if (!status.ok) return `Storage problem while trying to ${status.stage}: ${status.error}`;
  return `Storage ready: your data (schema v${status.user.to}) and market cache (schema v${status.cache.to}), SQLite ${status.sqliteVersion}.`;
}

export function App() {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void openDatabases().then(setStatus);
    void requestPersistentStorage().then(setPersisted);
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <h1>{APP_NAME}</h1>
        <p className="tagline">Track your investments against the plan you made for them.</p>
      </header>
      <section className="status" aria-label="Project status">
        <p>
          This is an early development build. There are no screens for entering data yet, so please don't enter real
          financial information.
        </p>
        <p className={status ? (status.ok ? 'result ok' : 'result fail') : 'result'} role="status">
          {describeStatus(status)}
        </p>
        <p className="muted small">
          Keep data on this device:{' '}
          {persisted === null ? 'not supported by this browser' : persisted ? 'granted' : 'not granted yet'}
        </p>
      </section>
    </main>
  );
}
