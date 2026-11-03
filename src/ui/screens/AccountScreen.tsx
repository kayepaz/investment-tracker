import { useState } from 'react';
import { db, errorMessage } from '../../db/client';
import type { TransactionRecord } from '../../db/repo';
import { averageCost, isOpen } from '../../holdings/positions';
import { accountTypeLabel } from '../../tax/ca/accountTypes';
import { loadAccount, securityLabel } from '../accountData';
import { formatDate, formatMoney, formatNumber } from '../format';
import { href } from '../router';
import { TRANSACTION_TYPE_LABELS } from '../transactionTypes';
import { useAsync } from '../useAsync';

function TransactionRow({
  transaction,
  label,
  problem,
  onDelete,
}: {
  transaction: TransactionRecord;
  label: string;
  problem: string | undefined;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = transaction;
  const detail = [
    t.quantity && t.type !== 'split' ? `${formatNumber(t.quantity)} units` : null,
    t.type === 'split' && t.quantity ? `ratio ${formatNumber(t.quantity)}` : null,
    t.price ? `@ ${formatNumber(t.price)}` : null,
    t.fee !== '0' && t.fee !== '' ? `fee ${formatMoney(t.fee, t.currency)}` : null,
    t.withholdingTax !== '0' ? `withheld ${formatMoney(t.withholdingTax, t.currency)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="ledger-row">
      <div className="ledger-main">
        <span className="small muted">{formatDate(t.tradeDate)}</span>
        <span>
          <strong>{TRANSACTION_TYPE_LABELS[t.type]}</strong> · {label}
        </span>
        {detail && <span className="small muted">{detail}</span>}
        {t.notes && <span className="small muted">{t.notes}</span>}
        {problem && <span className="badge-warn small">{problem}</span>}
      </div>
      <div className="ledger-side">
        {t.type !== 'split' && <span className="small">{formatMoney(t.amount, t.currency)}</span>}
        {!confirming ? (
          <button type="button" className="link-button small" onClick={() => setConfirming(true)}>
            Delete
          </button>
        ) : (
          <span className="confirm small">
            <button
              type="button"
              className="link-button danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onDelete().finally(() => {
                  setBusy(false);
                  setConfirming(false);
                });
              }}
            >
              Confirm
            </button>
            <button type="button" className="link-button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

export function AccountScreen({ id }: { id: string }) {
  const [state, reload] = useAsync(() => loadAccount(id), [id]);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="result fail">{state.message}</p>;
  if (!state.data) {
    return (
      <section>
        <p>That account doesn’t exist.</p>
        <a href={href({ name: 'accounts' })}>‹ Accounts</a>
      </section>
    );
  }

  const { account, transactions, positions, problems, securities } = state.data;
  const open = positions.filter(isOpen);
  const cash = open.filter((p) => p.isCash);
  const holdings = open.filter((p) => !p.isCash);
  const problemById = new Map(problems.map((p) => [p.transactionId, p.message]));

  async function remove(transactionId: string) {
    setError(null);
    try {
      await db('deleteTransaction', transactionId);
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section>
      <p>
        <a href={href({ name: 'accounts' })}>‹ Accounts</a>
      </p>
      <div className="screen-header">
        <div>
          <h1>{account.name}</h1>
          <p className="muted small">
            {accountTypeLabel(account.accountType)}
            {account.institution ? ` · ${account.institution}` : ''} · {account.currency}
          </p>
        </div>
        <a className="button-link" href={href({ name: 'transaction-new', accountId: account.id })}>
          + Add transaction
        </a>
      </div>

      {problems.length > 0 && (
        <p className="result fail small" role="alert">
          {problems.length} transaction{problems.length === 1 ? '' : 's'} couldn’t be applied and {problems.length === 1 ? 'is' : 'are'} left out of the
          figures below. They’re marked in the list.
        </p>
      )}
      {error && (
        <p className="result fail small" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <h2>Cash</h2>
        {cash.length === 0 ? (
          <p className="muted small">No cash.</p>
        ) : (
          <ul className="plain">
            {cash.map((p) => (
              <li key={p.securityId} className="row-between">
                <span>{p.currency}</span>
                <strong className={p.quantity.isNegative() ? 'negative' : undefined}>{formatMoney(p.quantity, p.currency)}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Holdings</h2>
        {holdings.length === 0 ? (
          <p className="muted small">No holdings yet. Add a buy, or an opening balance for something you already own.</p>
        ) : (
          <ul className="plain">
            {holdings.map((p) => {
              const avg = averageCost(p);
              return (
                <li key={p.securityId} className="holding-row">
                  <span className="list-title">{securityLabel(securities.get(p.securityId))}</span>
                  <span className="small muted">
                    {formatNumber(p.quantity)} units · avg cost {avg ? formatNumber(avg, 4) : '—'} · cost {formatMoney(p.cost, p.currency)}
                    {!p.income.isZero() ? ` · income ${formatMoney(p.income, p.currency)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted small">Market values appear once prices are added in a later step.</p>
      </div>

      <div className="card">
        <h2>Transactions</h2>
        {transactions.length === 0 ? (
          <p className="muted small">None yet.</p>
        ) : (
          <ul className="plain">
            {[...transactions].reverse().map((t) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                label={securityLabel(t.security)}
                problem={problemById.get(t.id)}
                onDelete={() => remove(t.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
