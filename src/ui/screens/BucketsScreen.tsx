import { useEffect, useState } from 'react';
import type { Decimal } from '../../money/decimal';
import type { BucketNode, HoldingRow } from '../../portfolio/tree';
import type { Evaluation } from '../../rules/evaluate';
import { refreshFxRatesIfStale } from '../../market/refresh';
import { providerById } from '../../market/providers';
import { updatePrices, type PriceUpdateSummary } from '../../market/updatePrices';
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

function Badge({ count, label }: { count: number | undefined; label: string }) {
  if (!count) return null;
  return (
    <span className="warning-badge" aria-label={`${count} ${label}${count === 1 ? '' : 's'}`}>
      {count}
    </span>
  );
}

function HoldingItem({ row, depth, currency, warnings }: { row: HoldingRow; depth: number; currency: string; warnings: number | undefined }) {
  return (
    <li>
      <a className="tree-row holding" style={{ paddingLeft: 16 + depth * 20 }} href={href({ name: 'holding', accountId: row.accountId, securityId: row.securityId })}>
        <span className="tree-main">
          <span className="tree-name">
            {row.label} <span className="muted small">· {row.accountName}</span> <Badge count={warnings} label="warning" />
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
  evaluation,
}: {
  node: BucketNode;
  depth: number;
  currency: string;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  evaluation: Evaluation;
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
            {node.bucket.name} <Badge count={evaluation.bucketCounts.get(node.bucket.id)} label="warning" />
            {node.unvalued > 0 && <span className="badge-warn small"> {node.unvalued} without a value</span>}
          </span>
          <Meta share={node.share} change={node.changePercent} gain={node.gain} currency={currency} />
        </span>
        <span className="tree-value strong">{formatMoney(node.value, currency)}</span>
      </div>
      {!isCollapsed && hasContent && (
        <ul className="plain">
          {node.children.map((child) => (
            <BucketItem key={child.bucket.id} node={child} depth={depth + 1} currency={currency} collapsed={collapsed} toggle={toggle} evaluation={evaluation} />
          ))}
          {node.holdings.map((row) => (
            <HoldingItem key={row.key} row={row} depth={depth + 1} currency={currency} warnings={evaluation.holdingCounts.get(row.key)} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PriceStatus({
  progress,
  summary,
  error,
  onUpdate,
}: {
  progress: { done: number; total: number } | null;
  summary: PriceUpdateSummary | null;
  error: string | null;
  onUpdate: () => void;
}) {
  if (progress) {
    return (
      <p className="muted small" role="status">
        Updating prices… {progress.done} of {progress.total}
      </p>
    );
  }
  if (error) return <p className="result fail small">Prices couldn’t be updated: {error}</p>;
  if (!summary) return null;

  const { plan, result } = summary;
  const count = (reason: string) => plan.skipped.filter((s) => s.reason === reason).length;
  const noKey = count('no_key');
  const limit = count('limit');
  const manualOnly = count('not_covered') + count('not_listed');
  const notes: string[] = [];
  if (result.updated > 0) notes.push(`Updated ${result.updated} price${result.updated === 1 ? '' : 's'}.`);
  for (const stop of result.stopped) notes.push(`${providerById(stop.providerId)?.name ?? stop.providerId}: ${stop.message}`);
  for (const failure of result.failures) notes.push(`${failure.security.symbol ?? failure.security.name}: ${failure.message}`);
  if (limit > 0) notes.push(`${limit} more will update tomorrow (free daily limit).`);
  if (manualOnly > 0) notes.push(`${manualOnly} holding${manualOnly === 1 ? ' isn’t' : 's aren’t'} covered by a provider; enter ${manualOnly === 1 ? 'its price' : 'their prices'} by hand.`);

  return (
    <div className="price-status small">
      {noKey > 0 && (
        <p className="badge-warn">
          {noKey} holding{noKey === 1 ? '' : 's'} could get prices automatically. <a href={href({ name: 'settings' })}>Add a free API key in Settings</a>.
        </p>
      )}
      {notes.map((note) => (
        <p key={note} className="muted">
          {note}
        </p>
      ))}
      {plan.tasks.length === 0 && noKey === 0 && plan.skipped.some((s) => s.reason === 'recent') && <p className="muted">Prices are up to date.</p>}
      <button type="button" className="link-button" onClick={onUpdate}>
        Check for new prices
      </button>
    </div>
  );
}

export function BucketsScreen() {
  const [state, reload] = useAsync(loadPortfolio, []);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [fxProblem, setFxProblem] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [priceSummary, setPriceSummary] = useState<PriceUpdateSummary | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  async function runPriceUpdate() {
    setPriceError(null);
    try {
      const summary = await updatePrices((done, total) => setProgress(total > 0 ? { done, total } : null));
      setPriceSummary(summary);
      if (summary.result.updated > 0) reload();
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  useEffect(() => {
    void refreshFxRatesIfStale().then((result) => {
      if (result === 'updated') reload();
      setFxProblem(result === 'failed');
    });
    void runPriceUpdate();
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

  const { tree, fxDate, problemCount, evaluation } = state.data;
  const portfolioWarnings = evaluation.warnings.filter((w) => w.target.kind === 'portfolio' && !w.hiddenBy);
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
        {portfolioWarnings.length > 0 && (
          <ul className="plain portfolio-warnings">
            {portfolioWarnings.map((w) => (
              <li key={w.key} className="badge-warn small">
                {w.message}
              </li>
            ))}
          </ul>
        )}
        {evaluation.visibleCount > 0 && (
          <a className="button-link warn" href={href({ name: 'warnings' })}>
            Show all warnings · {evaluation.visibleCount}
          </a>
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
              <BucketItem key={node.bucket.id} node={node} depth={0} currency={currency} collapsed={collapsed} toggle={toggle} evaluation={evaluation} />
            ))}
          </ul>
        </>
      )}

      <PriceStatus progress={progress} summary={priceSummary} error={priceError} onUpdate={() => void runPriceUpdate()} />

      <p className="muted small">
        {fxProblem
          ? 'Couldn’t reach the Bank of Canada for exchange rates; using the last ones saved.'
          : fxDate
            ? `Exchange rates: Bank of Canada, ${formatDate(fxDate)}.`
            : 'Exchange rates: not downloaded yet.'}
      </p>
    </section>
  );
}
