import { useEffect, useState } from 'react';
import type { Decimal } from '../../money/decimal';
import type { BucketNode, HoldingRow } from '../../portfolio/tree';
import { refreshFxRatesIfStale } from '../../market/refresh';
import { formatDate, formatMoney, formatPercent, formatSignedMoney } from '../format';
import { loadPortfolio } from '../portfolioData';
import { href } from '../router';
import { useAsync } from '../useAsync';

function Gain({ value, currency }: { value: Decimal; currency: string }) {
  const className = value.isNegative() ? 'loss' : value.isZero() ? undefined : 'gain';
  return <span className={className}>{formatSignedMoney(value, currency)}</span>;
}

function Meta({ share, change, gain, currency }: { share: Decimal | null; change: Decimal | null; gain: Decimal | null; currency: string }) {
  return (
    <span className="tree-meta small">
      <span>{share ? formatPercent(share) : '—'}</span>
      <span>{change ? `${change.isNegative() ? '' : '+'}${formatPercent(change)}` : '—'}</span>
      {gain ? <Gain value={gain} currency={currency} /> : <span>—</span>}
    </span>
  );
}

function HoldingItem({ row, depth, currency }: { row: HoldingRow; depth: number; currency: string }) {
  return (
    <li>
      <a className="tree-row holding" style={{ paddingLeft: 16 + depth * 20 }} href={href({ name: 'holding', accountId: row.accountId, securityId: row.securityId })}>
        <span className="tree-main">
          <span className="tree-name">
            {row.label} <span className="muted small">· {row.accountName}</span>
          </span>
          {row.missing === null ? (
            <Meta share={row.share} change={row.changePercent} gain={row.gain} currency={currency} />
          ) : (
            <span className="badge-warn small">{row.missing === 'price' ? 'No price yet: tap to add one' : `No ${row.currency} exchange rate yet`}</span>
          )}
        </span>
        <span className="tree-value">{row.value ? formatMoney(row.value, currency) : '—'}</span>
      </a>
    </li>
  );
}

function BucketItem({
  node,
  depth,
  currency,
  collapsed,
  toggle,
}: {
  node: BucketNode;
  depth: number;
  currency: string;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const isCollapsed = collapsed.has(node.bucket.id);
  const hasContent = node.children.length > 0 || node.holdings.length > 0;
  return (
    <li>
      <div className={`tree-row bucket${depth > 0 ? ' nested' : ''}`} style={{ paddingLeft: 4 + depth * 20 }}>
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.bucket.name}`}
          onClick={() => toggle(node.bucket.id)}
          disabled={!hasContent}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isCollapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m6 9 6 6 6-6" />}
          </svg>
        </button>
        <span className="tree-main">
          <span className={`tree-name strong${node.bucket.isUnassigned ? ' unassigned' : ''}`}>
            {node.bucket.name}
            {node.unvalued > 0 && <span className="badge-warn small"> {node.unvalued} without a value</span>}
          </span>
          <Meta share={node.share} change={node.changePercent} gain={node.gain} currency={currency} />
        </span>
        <span className="tree-value strong">{formatMoney(node.value, currency)}</span>
      </div>
      {!isCollapsed && hasContent && (
        <ul className="plain">
          {node.children.map((child) => (
            <BucketItem key={child.bucket.id} node={child} depth={depth + 1} currency={currency} collapsed={collapsed} toggle={toggle} />
          ))}
          {node.holdings.map((row) => (
            <HoldingItem key={row.key} row={row} depth={depth + 1} currency={currency} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function BucketsScreen() {
  const [state, reload] = useAsync(loadPortfolio, []);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [fxProblem, setFxProblem] = useState(false);

  useEffect(() => {
    void refreshFxRatesIfStale().then((result) => {
      if (result === 'updated') reload();
      setFxProblem(result === 'failed');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="result fail">{state.message}</p>;

  const { tree, fxDate, problemCount } = state.data;
  const currency = tree.nativeCurrency;

  return (
    <section>
      <header className="portfolio-header">
        <span className="muted small">Total portfolio · {currency}</span>
        <span className="portfolio-total">{formatMoney(tree.total.value, currency)}</span>
        {tree.total.holdingCount > 0 && (
          <span className="small">
            <Gain value={tree.total.gain} currency={currency} /> <span className="muted">gain/loss incl. income</span>
          </span>
        )}
        {tree.total.unvalued > 0 && (
          <span className="badge-warn small">
            {tree.total.unvalued} holding{tree.total.unvalued === 1 ? '' : 's'} not counted yet: no price or exchange rate
          </span>
        )}
        {problemCount > 0 && (
          <a className="small" href={href({ name: 'accounts' })}>
            {problemCount} transaction{problemCount === 1 ? '' : 's'} need attention
          </a>
        )}
      </header>

      <div className="screen-header">
        <h1>Buckets</h1>
        <a className="button-link secondary" href={href({ name: 'buckets-manage' })}>
          Manage buckets
        </a>
      </div>

      {tree.total.holdingCount === 0 ? (
        <div className="card">
          <p>Nothing to show yet.</p>
          <p className="muted small">Add an account and its holdings first; they appear here in the Unassigned bucket until you move them.</p>
          <p>
            <a className="button-link" href={href({ name: 'accounts' })}>
              Go to Accounts
            </a>
          </p>
        </div>
      ) : (
        <>
          <p className="muted small tree-legend">Value · share of total · change since purchase · gain/loss</p>
          <ul className="plain tree">
            {tree.roots.map((node) => (
              <BucketItem key={node.bucket.id} node={node} depth={0} currency={currency} collapsed={collapsed} toggle={toggle} />
            ))}
          </ul>
        </>
      )}

      <p className="muted small">
        {fxProblem
          ? 'Couldn’t reach the Bank of Canada for exchange rates; using the last ones saved.'
          : fxDate
            ? `Exchange rates: Bank of Canada, ${formatDate(fxDate)}.`
            : 'Exchange rates: not downloaded yet.'}{' '}
        Prices are the latest you entered; automatic prices come in the next step.
      </p>
    </section>
  );
}
