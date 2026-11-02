import { useEffect, useState } from 'react';
import {
  BANK_OF_CANADA_USDCAD_URL,
  describeResult,
  eodhdLastCloseUrl,
  fetchAndParse,
  parseBankOfCanada,
  parseEodhdLastClose,
} from './providers';
import type { DbTestResult, ProviderResult } from './types';

const KEY_STORAGE = 'spike.eodhdKey';

function readSavedKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function saveKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Storage unavailable; the key just won't be remembered.
  }
}

type StorageInfo = {
  opfsAvailable: boolean;
  persisted: boolean | null;
  usageMb: string | null;
  quotaMb: string | null;
};

async function readStorageInfo(): Promise<StorageInfo> {
  const storage = navigator.storage as StorageManager | undefined;
  const opfsAvailable = typeof storage?.getDirectory === 'function';
  const persisted = typeof storage?.persisted === 'function' ? await storage.persisted() : null;
  let usageMb: string | null = null;
  let quotaMb: string | null = null;
  if (typeof storage?.estimate === 'function') {
    const estimate = await storage.estimate();
    usageMb = estimate.usage !== undefined ? (estimate.usage / 1_048_576).toFixed(1) : null;
    quotaMb = estimate.quota !== undefined ? (estimate.quota / 1_048_576).toFixed(0) : null;
  }
  return { opfsAvailable, persisted, usageMb, quotaMb };
}

function runDbTest(): Promise<DbTestResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./dbWorker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, stage: 'start', error: 'Timed out after 20 seconds', inMemoryWorks: false });
    }, 20_000);
    worker.onmessage = (event: MessageEvent<DbTestResult>) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve({ ok: false, stage: 'start worker', error: event.message || 'Worker failed to start', inMemoryWorks: false });
    };
    worker.postMessage({ type: 'run' });
  });
}

function describeDb(result: DbTestResult | null): string {
  if (!result) return 'not run';
  if (result.ok) {
    return `OK: SQLite ${result.sqliteVersion} on ${result.storage}; ${result.rowCount} row(s) stored, first on ${result.firstRunAt}`;
  }
  return `FAILED at "${result.stage}": ${result.error}; SQLite ${result.sqliteVersion ?? 'unknown'}; in-memory SQLite ${result.inMemoryWorks ? 'works' : 'does not work'}`;
}

function persistedText(value: boolean | null): string {
  if (value === null) return 'not supported';
  return value ? 'granted' : 'not granted';
}

export function SpikePanel() {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [dbResult, setDbResult] = useState<DbTestResult | null>(null);
  const [dbRunning, setDbRunning] = useState(false);
  const [bocResult, setBocResult] = useState<ProviderResult | null>(null);
  const [eodhdResult, setEodhdResult] = useState<ProviderResult | null>(null);
  const [providersRunning, setProvidersRunning] = useState(false);
  const [apiKey, setApiKey] = useState(readSavedKey);
  const [symbol, setSymbol] = useState('XIU.TO');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void readStorageInfo().then(setStorageInfo);
  }, []);

  async function handleDbTest() {
    setDbRunning(true);
    setDbResult(await runDbTest());
    setStorageInfo(await readStorageInfo());
    setDbRunning(false);
  }

  async function handlePersist() {
    if (typeof navigator.storage?.persist === 'function') {
      await navigator.storage.persist();
    }
    setStorageInfo(await readStorageInfo());
  }

  async function handleProviders() {
    setProvidersRunning(true);
    saveKey(apiKey.trim());
    const bocPromise = fetchAndParse(BANK_OF_CANADA_USDCAD_URL, parseBankOfCanada);
    const eodhdPromise: Promise<ProviderResult> = apiKey.trim()
      ? fetchAndParse(eodhdLastCloseUrl(symbol.trim(), apiKey.trim()), (json) => parseEodhdLastClose(symbol.trim(), json))
      : Promise.resolve({ ok: false, kind: 'missing-key', detail: 'No EODHD API key entered' });
    const [boc, eodhd] = await Promise.all([bocPromise, eodhdPromise]);
    setBocResult(boc);
    setEodhdResult(eodhd);
    setProvidersRunning(false);
  }

  const report = [
    'Investment Tracker technical test',
    `Date: ${new Date().toISOString()}`,
    `Browser: ${navigator.userAgent}`,
    `OPFS available: ${storageInfo ? (storageInfo.opfsAvailable ? 'yes' : 'no') : 'checking'}`,
    `Persistent storage: ${storageInfo ? persistedText(storageInfo.persisted) : 'checking'}`,
    `Storage used: ${storageInfo?.usageMb ?? '?'} MB of ${storageInfo?.quotaMb ?? '?'} MB`,
    `Database: ${describeDb(dbResult)}`,
    `Bank of Canada: ${describeResult(bocResult)}`,
    `EODHD (${symbol.trim()}): ${describeResult(eodhdResult)}`,
  ].join('\n');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="spike" aria-labelledby="spike-title">
      <h2 id="spike-title">Technical test</h2>
      <p className="muted">
        Checks whether this browser can keep a database on your device and reach the data providers. Nothing
        here uses real financial data.
      </p>

      <div className="spike-step">
        <h3>1. Database on this device</h3>
        <p className="muted">
          Run the test, then <strong>reload the page</strong> (or close and reopen the app) and run it again. If the
          row count goes up each time, data is being kept.
        </p>
        <div className="button-row">
          <button type="button" onClick={handleDbTest} disabled={dbRunning}>
            {dbRunning ? 'Running…' : 'Run database test'}
          </button>
          <button type="button" className="secondary" onClick={handlePersist}>
            Ask to keep data
          </button>
        </div>
        <p className={dbResult ? (dbResult.ok ? 'result ok' : 'result fail') : 'result'}>{describeDb(dbResult)}</p>
        <p className="muted small">
          On-device storage: {storageInfo ? (storageInfo.opfsAvailable ? 'available' : 'not available') : 'checking'} ·
          Keep data: {storageInfo ? persistedText(storageInfo.persisted) : 'checking'}
        </p>
      </div>

      <div className="spike-step">
        <h3>2. Data providers</h3>
        <label className="field">
          EODHD API key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste your key"
          />
        </label>
        <label className="field">
          Symbol
          <input value={symbol} onChange={(event) => setSymbol(event.target.value)} />
        </label>
        <p className="muted small">Your key is saved only in this browser and is not included in the report.</p>
        <div className="button-row">
          <button type="button" onClick={handleProviders} disabled={providersRunning}>
            {providersRunning ? 'Checking…' : 'Check providers'}
          </button>
        </div>
        <p className={bocResult ? (bocResult.ok ? 'result ok' : 'result fail') : 'result'}>
          Bank of Canada: {describeResult(bocResult)}
        </p>
        <p className={eodhdResult ? (eodhdResult.ok ? 'result ok' : 'result fail') : 'result'}>
          EODHD: {describeResult(eodhdResult)}
        </p>
      </div>

      <div className="spike-step">
        <h3>3. Send the results</h3>
        <pre className="report">{report}</pre>
        <div className="button-row">
          <button type="button" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy results'}
          </button>
        </div>
      </div>
    </section>
  );
}
