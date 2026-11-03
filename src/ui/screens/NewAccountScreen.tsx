import { useState, type FormEvent } from 'react';
import { db, errorMessage } from '../../db/client';
import { CA_ACCOUNT_TYPES, CA_TAX_CURRENCY } from '../../tax/ca/accountTypes';
import { CURRENCIES } from '../currencies';
import { today } from '../format';
import { href, navigate } from '../router';

export function NewAccountScreen() {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [accountType, setAccountType] = useState('tfsa');
  const [currency, setCurrency] = useState('CAD');
  const [openedDate, setOpenedDate] = useState(today());
  const [openingCash, setOpeningCash] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsFx = currency !== CA_TAX_CURRENCY && openingCash.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const account = await db('createAccount', {
        name,
        institution,
        accountType,
        currency,
        openedDate,
        openingCash,
        openingCashFxRate: needsFx ? fxRate : undefined,
      });
      navigate({ name: 'account', id: account.id });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <section>
      <p>
        <a href={href({ name: 'accounts' })}>‹ Accounts</a>
      </p>
      <h1>New account</h1>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Questrade TFSA" required />
        </label>
        <label className="field">
          Institution <span className="muted">(optional)</span>
          <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Questrade" />
        </label>
        <div className="field-row">
          <label className="field">
            Type
            <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
              {CA_ACCOUNT_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          Start date in this app
          <input type="date" value={openedDate} onChange={(e) => setOpenedDate(e.target.value)} />
          <span className="hint">Opening balances are recorded on this date.</span>
        </label>
        <label className="field">
          Cash in the account on that date <span className="muted">(optional)</span>
          <input inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="e.g. 1500.00" />
          <span className="hint">Holdings you already own are added next, as opening balances.</span>
        </label>
        {needsFx && (
          <label className="field">
            {currency} → CAD exchange rate on that date
            <input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="e.g. 1.3978" />
            <span className="hint">CAD per 1 {currency}, for tax records. Automatic lookup comes in a later step.</span>
          </label>
        )}
        {error && (
          <p className="result fail" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Create account'}
          </button>
          <a className="button-link secondary" href={href({ name: 'accounts' })}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
