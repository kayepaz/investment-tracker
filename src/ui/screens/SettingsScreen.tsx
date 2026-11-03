import { useState } from 'react';
import { db, errorMessage } from '../../db/client';
import type { DbStatus } from '../../db/protocol';
import { DEFAULT_NATIVE_CURRENCY, SETTING_NATIVE_CURRENCY } from '../../db/repo';
import { CURRENCIES } from '../currencies';
import { useAsync } from '../useAsync';

export function SettingsScreen({ status, persisted }: { status: DbStatus | null; persisted: boolean | null }) {
  const [native] = useAsync(() => db('getSetting', SETTING_NATIVE_CURRENCY), []);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeNative(value: string) {
    setError(null);
    try {
      await db('setSetting', SETTING_NATIVE_CURRENCY, value);
      setSaved(value);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const current = saved ?? (native.status === 'ready' ? native.data ?? DEFAULT_NATIVE_CURRENCY : DEFAULT_NATIVE_CURRENCY);

  return (
    <section>
      <h1>Settings</h1>

      <div className="card">
        <h2>Native currency</h2>
        <p className="muted small">All totals and summaries are shown in this currency.</p>
        <label className="field">
          Currency
          <select value={current} onChange={(event) => void changeNative(event.target.value)} disabled={native.status !== 'ready'}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        {saved && <p className="result ok small">Saved.</p>}
        {error && <p className="result fail small">{error}</p>}
      </div>

      <div className="card">
        <h2>Storage</h2>
        <p className="small">
          {status === null
            ? 'Opening…'
            : status.ok
              ? `Your data (schema v${status.user.to}) and market cache (schema v${status.cache.to}) are stored on this device. SQLite ${status.sqliteVersion}.`
              : `Problem while trying to ${status.stage}: ${status.error}`}
        </p>
        <p className="muted small">
          Keep data on this device:{' '}
          {persisted === null ? 'not supported by this browser' : persisted ? 'granted' : 'not granted yet (installing the app usually helps)'}
        </p>
      </div>
    </section>
  );
}
