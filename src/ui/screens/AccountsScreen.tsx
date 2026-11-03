import { db } from '../../db/client';
import { accountTypeLabel } from '../../tax/ca/accountTypes';
import { loadAccount } from '../accountData';
import { formatMoney } from '../format';
import { href } from '../router';
import { useAsync } from '../useAsync';

async function loadSummaries() {
  const accounts = await db('listAccounts');
  return Promise.all(
    accounts.map(async (account) => {
      const data = await loadAccount(account.id);
      const positions = data?.positions ?? [];
      return {
        account,
        cash: positions.filter((p) => p.isCash && !p.quantity.isZero()),
        holdings: positions.filter((p) => !p.isCash && !p.quantity.isZero()).length,
        problems: data?.problems.length ?? 0,
      };
    }),
  );
}

export function AccountsScreen() {
  const [state] = useAsync(loadSummaries, []);

  return (
    <section>
      <div className="screen-header">
        <h1>Accounts</h1>
        <a className="button-link" href={href({ name: 'account-new' })}>
          + New account
        </a>
      </div>

      {state.status === 'loading' && <p className="muted">Loading…</p>}
      {state.status === 'error' && <p className="result fail">{state.message}</p>}
      {state.status === 'ready' && state.data.length === 0 && (
        <div className="card">
          <p>No accounts yet.</p>
          <p className="muted small">
            Add one for each real brokerage account, such as “Questrade TFSA”. You can start it with the cash it holds
            today and add your holdings as opening balances.
          </p>
        </div>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="list">
          {state.data.map(({ account, cash, holdings, problems }) => (
            <li key={account.id}>
              <a className="list-row" href={href({ name: 'account', id: account.id })}>
                <span className="list-main">
                  <span className="list-title">{account.name}</span>
                  <span className="muted small">
                    {accountTypeLabel(account.accountType)}
                    {account.institution ? ` · ${account.institution}` : ''} · {holdings} holding{holdings === 1 ? '' : 's'}
                  </span>
                  {problems > 0 && <span className="badge-warn small">{problems} transaction{problems === 1 ? '' : 's'} need attention</span>}
                </span>
                <span className="list-side small">
                  {cash.length === 0 ? <span className="muted">No cash</span> : cash.map((p) => <span key={p.securityId}>{formatMoney(p.quantity, p.currency)}</span>)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
