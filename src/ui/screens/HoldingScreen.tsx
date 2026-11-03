import { useState, type FormEvent } from 'react';
import { db, errorMessage } from '../../db/client';
import { flattenBuckets, type BucketNode, type HoldingRow } from '../../portfolio/tree';
import { formatDate, formatMoney, formatNumber, formatPercent, formatSignedMoney, today } from '../format';
import { loadPortfolio } from '../portfolioData';
import { href } from '../router';
import { useAsync } from '../useAsync';

function findHolding(nodes: BucketNode[], key: string): { row: HoldingRow; bucketId: string } | null {
  for (const node of nodes) {
    const row = node.holdings.find((h) => h.key === key);
    if (row) return { row, bucketId: node.bucket.id };
    const inChild = findHolding(node.children, key);
    if (inChild) return inChild;
  }
  return null;
}

export function HoldingScreen({ accountId, securityId }: { accountId: string; securityId: string }) {
  const [state, reload] = useAsync(loadPortfolio, []);
  const [price, setPrice] = useState('');
  const [priceDate, setPriceDate] = useState(today());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="result fail">{state.message}</p>;

  const { tree, buckets, securities } = state.data;
  const found = findHolding(tree.roots, `${accountId}|${securityId}`);
  const security = securities.get(securityId);
  if (!found || !security) {
    return (
      <section>
        <p>This holding isn’t open any more (or doesn’t exist).</p>
        <a href={href({ name: 'buckets' })}>‹ Buckets</a>
      </section>
    );
  }
  const { row, bucketId } = found;
  const currency = tree.nativeCurrency;
  const options = flattenBuckets(buckets);

  async function savePrice(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await db('setManualPrice', { securityId, priceDate, price, currency: row.currency });
      setPrice('');
      setMessage({ ok: true, text: 'Price saved.' });
      reload();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  async function move(targetId: string) {
    setMessage(null);
    try {
      await db('assignHolding', { accountId, securityId, bucketId: targetId });
      setMessage({ ok: true, text: 'Moved.' });
      reload();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  return (
    <section>
      <p>
        <a href={href({ name: 'buckets' })}>‹ Buckets</a>
      </p>
      <h1>{row.label}</h1>
      <p className="muted small">
        {security.kind === 'cash' ? `${security.currency} cash` : `${security.name} · ${security.currency}`} ·{' '}
        <a href={href({ name: 'account', id: accountId })}>{row.accountName}</a>
      </p>

      <div className="stat-grid">
        <div className="stat">
          <span className="muted small">Value ({currency})</span>
          <strong>{row.value ? formatMoney(row.value, currency) : '—'}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Change</span>
          <strong>{row.changePercent ? `${row.changePercent.isNegative() ? '' : '+'}${formatPercent(row.changePercent)}` : '—'}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Gain/loss</span>
          <strong className={row.gain?.isNegative() ? 'loss' : 'gain'}>{row.gain ? formatSignedMoney(row.gain, currency) : '—'}</strong>
        </div>
      </div>
      <p className="muted small">
        {formatNumber(row.quantity)} {row.isCash ? row.currency : 'units'}
        {row.price ? ` · price ${formatNumber(row.price.price, 4)} ${row.currency} on ${formatDate(row.price.date)} (entered by hand)` : ''}
      </p>

      {message && <p className={`result small ${message.ok ? 'ok' : 'fail'}`} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      {!row.isCash && (
        <form className="card form" onSubmit={(event) => void savePrice(event)} noValidate>
          <h2>Set price</h2>
          <div className="field-row">
            <label className="field">
              Price per unit ({row.currency})
              <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 54.07" />
            </label>
            <label className="field">
              Date
              <input type="date" value={priceDate} onChange={(e) => setPriceDate(e.target.value)} />
            </label>
          </div>
          <div className="button-row">
            <button type="submit">Save price</button>
          </div>
          <p className="hint">Until automatic prices arrive, the latest price you enter is used.</p>
        </form>
      )}

      <div className="card">
        <h2>Bucket</h2>
        <label className="field">
          Move to
          <select value={bucketId} onChange={(e) => void move(e.target.value)}>
            {options.map(({ bucket, depth, isLeaf }) => (
              <option key={bucket.id} value={bucket.id} disabled={!isLeaf}>
                {'  '.repeat(depth)}
                {bucket.name}
                {isLeaf ? '' : ' (has sub-buckets)'}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          Only buckets without sub-buckets hold investments. <a href={href({ name: 'buckets-manage' })}>Manage buckets</a>
        </p>
      </div>
    </section>
  );
}
