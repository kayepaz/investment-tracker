import { useState } from 'react';
import { db, errorMessage } from '../db/client';
import { usageToday } from '../market/updatePrices';
import { PRICE_PROVIDERS, type PriceProvider } from '../market/providers';
import { useAsync } from './useAsync';

async function loadProviders() {
  const [keys, usage] = await Promise.all([db('getApiKeys'), usageToday()]);
  return { keys, usage };
}

function ProviderRow({
  provider,
  savedKey,
  used,
  onChanged,
}: {
  provider: PriceProvider;
  savedKey: string | undefined;
  used: number;
  onChanged: () => void;
}) {
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setMessage(null);
    try {
      await db('setApiKey', provider.id, key);
      setKey('');
      setMessage({ ok: true, text: 'Key saved. Prices update when you open Buckets.' });
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  async function remove() {
    setMessage(null);
    await db('deleteApiKey', provider.id);
    onChanged();
  }

  return (
    <div className="provider-row">
      <h3>
        {provider.name}{' '}
        <a className="small" href={provider.signupUrl} target="_blank" rel="noreferrer">
          Get a free key
        </a>
      </h3>
      <p className="hint">{provider.note}</p>
      {savedKey ? (
        <div className="row-between">
          <span className="small">
            Key saved (ending …{savedKey.slice(-4)})
            {provider.dailyLimit !== null && (
              <span className="muted">
                {' '}
                · {used} of {provider.dailyLimit} requests used in the last 24 hours
              </span>
            )}
          </span>
          <button type="button" className="link-button" onClick={() => void remove()}>
            Remove
          </button>
        </div>
      ) : (
        <div className="field-row">
          <label className="field">
            {provider.name} API key
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
          </label>
          <div className="button-row align-end">
            <button type="button" onClick={() => void save()} disabled={!key.trim()}>
              Save key
            </button>
          </div>
        </div>
      )}
      {message && <p className={`result small ${message.ok ? 'ok' : 'fail'}`}>{message.text}</p>}
    </div>
  );
}

export function ProvidersCard() {
  const [state, reload] = useAsync(loadProviders, []);
  return (
    <div className="card">
      <h2>Price providers</h2>
      <p className="muted small">
        Prices are downloaded with your own free API keys, straight from this device. Keys are stored only here, and
        only included in backups you encrypt.
      </p>
      {state.status === 'loading' && <p className="muted small">Loading…</p>}
      {state.status === 'error' && <p className="result fail small">{state.message}</p>}
      {state.status === 'ready' &&
        PRICE_PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            savedKey={state.data.keys[provider.id]}
            used={state.data.usage[provider.id] ?? 0}
            onChanged={reload}
          />
        ))}
    </div>
  );
}
