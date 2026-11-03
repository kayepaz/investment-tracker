import { useState, type FormEvent } from 'react';
import { db, errorMessage } from '../../db/client';
import type { Security, SecurityKind } from '../../db/repo';
import type { TransactionType } from '../../holdings/positions';
import { Decimal } from '../../money/decimal';
import { CA_TAX_CURRENCY } from '../../tax/ca/accountTypes';
import { CURRENCIES, EXCHANGES } from '../currencies';
import { today } from '../format';
import { href, navigate } from '../router';
import { FORM_FIELDS, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPE_ORDER } from '../transactionTypes';
import { useAsync } from '../useAsync';

// The subject picker's value: an existing security, cash in a currency, or a new security.
type Subject = { kind: 'security'; id: string } | { kind: 'cash'; currency: string } | { kind: 'new' } | { kind: 'none' };

function encodeSubject(subject: Subject): string {
  switch (subject.kind) {
    case 'security':
      return `sec:${subject.id}`;
    case 'cash':
      return `cash:${subject.currency}`;
    case 'new':
      return 'new';
    default:
      return '';
  }
}

function decodeSubject(value: string): Subject {
  if (value.startsWith('sec:')) return { kind: 'security', id: value.slice(4) };
  if (value.startsWith('cash:')) return { kind: 'cash', currency: value.slice(5) };
  if (value === 'new') return { kind: 'new' };
  return { kind: 'none' };
}

const KIND_LABELS: Record<Exclude<SecurityKind, 'cash'>, string> = {
  stock: 'Stock',
  etf: 'ETF',
  fund: 'Mutual fund',
  bond: 'Bond',
  crypto: 'Crypto',
  real_estate: 'Real estate',
  other: 'Other',
};

/** Keeps the picker's choice consistent with what the transaction type allows. */
function allowedSubject(
  subject: Subject,
  allowed: 'security' | 'cash' | 'either',
  accountCurrency: string,
  securities: Security[],
): Subject {
  if (allowed === 'cash' && subject.kind !== 'cash') return { kind: 'cash', currency: accountCurrency };
  if (allowed === 'security' && subject.kind === 'cash') {
    return securities[0] ? { kind: 'security', id: securities[0].id } : { kind: 'new' };
  }
  return subject;
}

function amountLabel(type: TransactionType, isCash: boolean): string {
  if (isCash) return 'Amount';
  switch (type) {
    case 'buy':
      return 'Total cost, before fees';
    case 'sell':
      return 'Total proceeds, before fees';
    case 'opening_balance':
    case 'transfer_in':
      return 'Total cost (book value)';
    case 'transfer_out':
      return 'Book value moved (optional; worked out from average cost)';
    case 'fee':
      return 'Fee amount';
    default:
      return 'Gross amount';
  }
}

function parseOrNull(text: string): Decimal | null {
  try {
    return Decimal.parse(text.trim());
  } catch {
    return null;
  }
}

async function loadFormData(accountId: string) {
  const [account, securities] = await Promise.all([db('getAccount', accountId), db('listSecurities')]);
  return { account, securities: securities.filter((s) => s.kind !== 'cash') };
}

export function AddTransactionScreen({ accountId }: { accountId: string }) {
  const [state] = useAsync(() => loadFormData(accountId), [accountId]);
  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="result fail">{state.message}</p>;
  if (!state.data.account) return <p>That account doesn’t exist.</p>;
  return <TransactionForm accountId={accountId} accountCurrency={state.data.account.currency} accountName={state.data.account.name} securities={state.data.securities} />;
}

function TransactionForm({
  accountId,
  accountCurrency,
  accountName,
  securities,
}: {
  accountId: string;
  accountCurrency: string;
  accountName: string;
  securities: Security[];
}) {
  const [type, setType] = useState<TransactionType>('buy');
  const [subjectValue, setSubjectValue] = useState(securities[0] ? `sec:${securities[0].id}` : 'new');
  const [tradeDate, setTradeDate] = useState(today());
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [withholding, setWithholding] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [notes, setNotes] = useState('');
  // New security fields
  const [newSymbol, setNewSymbol] = useState('');
  const [newExchange, setNewExchange] = useState('XTSE');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<Exclude<SecurityKind, 'cash'>>('stock');
  const [newCurrency, setNewCurrency] = useState('CAD');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = FORM_FIELDS[type];
  const cashOptions = [...new Set([accountCurrency, 'CAD', 'USD'])];

  const subject = allowedSubject(decodeSubject(subjectValue), fields.subject, accountCurrency, securities);
  const isCash = subject.kind === 'cash';
  const selectedId = subject.kind === 'security' ? subject.id : null;
  const selected = securities.find((s) => s.id === selectedId);
  const listedNew = newExchange !== 'NONE';
  const currency = subject.kind === 'cash' ? subject.currency : subject.kind === 'new' ? newCurrency : (selected?.currency ?? accountCurrency);
  const needsFx = currency !== CA_TAX_CURRENCY;
  const showQuantity = fields.quantity && !isCash;

  // Suggest amount = quantity × price while the amount is empty.
  const q = parseOrNull(quantity);
  const p = parseOrNull(price);
  const suggestedAmount = fields.price && q && p ? q.times(p).toString() : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let securityId: string | undefined;
      if (subject.kind === 'security') securityId = subject.id;
      if (subject.kind === 'new') {
        const created = await db('findOrCreateSecurity', {
          kind: newKind,
          symbol: listedNew ? newSymbol : undefined,
          exchange: listedNew ? newExchange : undefined,
          name: newName,
          currency: newCurrency,
        });
        securityId = created.id;
      }
      const amountText = amount.trim() || suggestedAmount || (type === 'split' || (type === 'transfer_out' && !isCash) ? '0' : '');
      await db('addTransaction', {
        accountId,
        type,
        securityId,
        currency: isCash ? currency : undefined,
        tradeDate,
        quantity: showQuantity ? quantity : undefined,
        price: fields.price ? price : undefined,
        amount: amountText,
        fee: fields.fee ? fee : undefined,
        withholdingTax: fields.withholding ? withholding : undefined,
        taxFxRate: needsFx ? fxRate : undefined,
        notes,
      });
      navigate({ name: 'account', id: accountId });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <section>
      <p>
        <a href={href({ name: 'account', id: accountId })}>‹ {accountName}</a>
      </p>
      <h1>Add transaction</h1>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="field">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
            {TRANSACTION_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {TRANSACTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        {fields.subject !== 'cash' ? (
          <label className="field">
            {fields.subject === 'either' ? 'Security or cash' : 'Security'}
            <select value={encodeSubject(subject)} onChange={(e) => setSubjectValue(e.target.value)}>
              {securities.map((s) => (
                <option key={s.id} value={`sec:${s.id}`}>
                  {s.symbol ? `${s.symbol} · ${s.name}` : s.name} ({s.currency})
                </option>
              ))}
              {fields.subject === 'either' &&
                cashOptions.map((code) => (
                  <option key={code} value={`cash:${code}`}>
                    Cash ({code})
                  </option>
                ))}
              <option value="new">+ New security…</option>
            </select>
          </label>
        ) : (
          <label className="field">
            Currency
            <select value={encodeSubject(subject)} onChange={(e) => setSubjectValue(e.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={`cash:${code}`}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        )}

        {subject.kind === 'new' && (
          <fieldset className="subform">
            <legend>New security</legend>
            <label className="field">
              Exchange
              <select
                value={newExchange}
                onChange={(e) => {
                  setNewExchange(e.target.value);
                  const exchange = EXCHANGES.find((x) => x.mic === e.target.value);
                  if (exchange) setNewCurrency(exchange.currency);
                }}
              >
                {EXCHANGES.map((x) => (
                  <option key={x.mic} value={x.mic}>
                    {x.label}
                  </option>
                ))}
                <option value="NONE">Not listed (priced by hand, e.g. real estate)</option>
              </select>
            </label>
            {listedNew && (
              <label className="field">
                Ticker symbol
                <input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="e.g. XIU" autoCapitalize="characters" />
              </label>
            )}
            <label className="field">
              Name
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. iShares S&P/TSX 60 Index ETF" />
            </label>
            <div className="field-row">
              <label className="field">
                Kind
                <select value={newKind} onChange={(e) => setNewKind(e.target.value as Exclude<SecurityKind, 'cash'>)}>
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Currency
                <select value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)}>
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
        )}

        <label className="field">
          Trade date
          <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
        </label>

        {showQuantity && (
          <label className="field">
            {type === 'split' ? 'Split ratio' : 'Quantity (units)'}
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={type === 'split' ? 'e.g. 2 for a 2-for-1 split' : 'e.g. 10'} />
          </label>
        )}

        {fields.price && (
          <label className="field">
            Price per unit <span className="muted">(optional)</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 54.07" />
          </label>
        )}

        {fields.amount && (
          <label className="field">
            {amountLabel(type, isCash)} ({currency})
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={suggestedAmount ?? 'e.g. 540.70'} />
            {suggestedAmount && !amount.trim() && <span className="hint">Leave blank to use quantity × price = {suggestedAmount}</span>}
          </label>
        )}

        {(fields.fee || fields.withholding) && (
          <div className="field-row">
            {fields.fee && (
              <label className="field">
                Fee <span className="muted">(optional)</span>
                <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
              </label>
            )}
            {fields.withholding && (
              <label className="field">
                Tax withheld <span className="muted">(optional)</span>
                <input inputMode="decimal" value={withholding} onChange={(e) => setWithholding(e.target.value)} placeholder="0" />
              </label>
            )}
          </div>
        )}

        {needsFx && (
          <label className="field">
            {currency} → CAD exchange rate on the trade date
            <input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="e.g. 1.3978" />
            <span className="hint">CAD per 1 {currency}, kept with this transaction for tax. Automatic lookup comes in a later step.</span>
          </label>
        )}

        <label className="field">
          Notes <span className="muted">(optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {!isCash && fields.subject !== 'cash' && type === 'buy' && (
          <p className="hint">The cost and fee are taken from this account’s {currency} cash automatically.</p>
        )}

        {error && (
          <p className="result fail" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save transaction'}
          </button>
          <a className="button-link secondary" href={href({ name: 'account', id: accountId })}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
