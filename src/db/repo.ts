// Reading and writing the user database. Every function takes a SqlConnection, so the same code
// runs in the browser worker (sqlite-wasm) and in tests (node:sqlite).

import { computePositions, type TransactionInput, type TransactionType } from '../holdings/positions';
import { CA_ACCOUNT_TYPES, CA_TAX_CURRENCY } from '../tax/ca/accountTypes';
import { Decimal } from '../money/decimal';
import { isCurrencyCode, isDecimalString, isIsoDate, uuidv7 } from './conventions';
import type { SqlConnection, SqlValue } from './migrate';

/** A problem with what the user entered; the message is shown to them. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function invalid(message: string): never {
  throw new ValidationError(message);
}

export function withTransaction<T>(db: SqlConnection, work: () => T): T {
  db.execScript('BEGIN');
  try {
    const result = work();
    db.execScript('COMMIT');
    return result;
  } catch (error) {
    db.execScript('ROLLBACK');
    throw error;
  }
}

const str = (value: SqlValue | undefined): string => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: SqlValue | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

// ---------------------------------------------------------------------------------------------
// Settings

export const SETTING_NATIVE_CURRENCY = 'native_currency';
export const DEFAULT_NATIVE_CURRENCY = 'CAD';

export function getSetting(db: SqlConnection, key: string): string | null {
  const rows = db.all('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0] ? str(rows[0].value) : null;
}

export function setSetting(db: SqlConnection, key: string, value: string, now: number): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now],
  );
}

// ---------------------------------------------------------------------------------------------
// Accounts

export type Account = {
  id: string;
  name: string;
  institution: string | null;
  accountType: string;
  currency: string;
  openedDate: string | null;
  notes: string | null;
};

function toAccount(row: Record<string, SqlValue>): Account {
  return {
    id: str(row.id),
    name: str(row.name),
    institution: strOrNull(row.institution),
    accountType: str(row.account_type),
    currency: str(row.currency),
    openedDate: strOrNull(row.opened_date),
    notes: strOrNull(row.notes),
  };
}

const ACCOUNT_COLUMNS = 'id, name, institution, account_type, currency, opened_date, notes';

export function listAccounts(db: SqlConnection): Account[] {
  return db.all(`SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY name COLLATE NOCASE`).map(toAccount);
}

export function getAccount(db: SqlConnection, id: string): Account | null {
  const row = db.all(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`, [id])[0];
  return row ? toAccount(row) : null;
}

export type NewAccount = {
  name: string;
  institution?: string;
  accountType: string;
  currency: string;
  openedDate: string;
  /** Cash in the account on the opened date, in the account currency. Optional. */
  openingCash?: string;
  /** Units of CAD per one unit of the account currency on the opened date; needed for non-CAD opening cash. */
  openingCashFxRate?: string;
  notes?: string;
};

export function createAccount(db: SqlConnection, input: NewAccount, now: number): Account {
  const name = input.name.trim();
  if (!name) invalid('Give the account a name.');
  if (!CA_ACCOUNT_TYPES.some((type) => type.id === input.accountType)) invalid('Choose an account type.');
  if (!isCurrencyCode(input.currency)) invalid('Choose the account currency.');
  if (!isIsoDate(input.openedDate)) invalid('Enter the date the account starts in this app.');
  const openingCash = input.openingCash?.trim() ?? '';
  if (openingCash !== '' && !isDecimalString(openingCash)) invalid('Opening cash must be a number like 1500 or 1500.25.');
  if (openingCash.startsWith('-')) invalid('Opening cash can’t be negative.');
  const openingCashFxRate = optionalDecimal(input.openingCashFxRate, 'Exchange rate');

  return withTransaction(db, () => {
    const id = uuidv7(now);
    db.run(
      `INSERT INTO accounts (id, name, institution, account_type, currency, opened_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, input.institution?.trim() || null, input.accountType, input.currency, input.openedDate, input.notes?.trim() || null, now, now],
    );
    if (openingCash !== '' && !Decimal.parse(openingCash).isZero()) {
      const cash = ensureCashSecurity(db, input.currency, now);
      insertTransactionRow(db, {
        accountId: id,
        securityId: cash.id,
        type: 'opening_balance',
        tradeDate: input.openedDate,
        quantity: null,
        price: null,
        amount: openingCash,
        fee: '0',
        withholdingTax: '0',
        currency: input.currency,
        taxFxRate: input.currency === CA_TAX_CURRENCY ? '1' : openingCashFxRate,
        notes: 'Opening cash balance',
      }, now);
    }
    return getAccount(db, id)!;
  });
}

// ---------------------------------------------------------------------------------------------
// Securities

export type SecurityKind = 'stock' | 'etf' | 'fund' | 'bond' | 'cash' | 'crypto' | 'real_estate' | 'other';

export type Security = {
  id: string;
  instrumentKey: string;
  kind: SecurityKind;
  symbol: string | null;
  exchange: string | null;
  name: string;
  currency: string;
};

function toSecurity(row: Record<string, SqlValue>): Security {
  return {
    id: str(row.id),
    instrumentKey: str(row.instrument_key),
    kind: str(row.kind) as SecurityKind,
    symbol: strOrNull(row.symbol),
    exchange: strOrNull(row.exchange),
    name: str(row.name),
    currency: str(row.currency),
  };
}

const SECURITY_COLUMNS = 'id, instrument_key, kind, symbol, exchange, name, currency';

export function listSecurities(db: SqlConnection): Security[] {
  return db.all(`SELECT ${SECURITY_COLUMNS} FROM securities ORDER BY kind = 'cash', symbol, name`).map(toSecurity);
}

function securityByKey(db: SqlConnection, instrumentKey: string): Security | null {
  const row = db.all(`SELECT ${SECURITY_COLUMNS} FROM securities WHERE instrument_key = ?`, [instrumentKey])[0];
  return row ? toSecurity(row) : null;
}

export function cashInstrumentKey(currency: string): string {
  return `CASH:${currency}`;
}

/** The cash security for a currency, created on first use. */
export function ensureCashSecurity(db: SqlConnection, currency: string, now: number): Security {
  if (!isCurrencyCode(currency)) invalid(`Unknown currency ${currency}.`);
  const key = cashInstrumentKey(currency);
  const existing = securityByKey(db, key);
  if (existing) return existing;
  db.run(
    `INSERT INTO securities (id, instrument_key, kind, symbol, exchange, name, currency, created_at, updated_at)
     VALUES (?, ?, 'cash', NULL, NULL, ?, ?, ?, ?)`,
    [uuidv7(now), key, `${currency} cash`, currency, now, now],
  );
  return securityByKey(db, key)!;
}

export type NewSecurity = {
  kind: Exclude<SecurityKind, 'cash'>;
  /** Ticker; required for listed securities. */
  symbol?: string;
  /** Exchange MIC (e.g. 'XTSE'), or omitted for unlisted things priced manually. */
  exchange?: string;
  name: string;
  currency: string;
};

/** Finds a security by exchange and ticker, or creates it. Unlisted securities always get a new record. */
export function findOrCreateSecurity(db: SqlConnection, input: NewSecurity, now: number): Security {
  const symbol = input.symbol?.trim().toUpperCase() ?? '';
  const exchange = input.exchange?.trim().toUpperCase() ?? '';
  const name = input.name.trim() || symbol;
  if (!name) invalid('Enter a name or symbol for the security.');
  if (!isCurrencyCode(input.currency)) invalid('Choose the security’s currency.');
  if (exchange && !symbol) invalid('Enter the ticker symbol.');

  const id = uuidv7(now);
  const key = exchange && symbol ? `${exchange}:${symbol}` : `USER:${id}`;
  const existing = securityByKey(db, key);
  if (existing) return existing;
  db.run(
    `INSERT INTO securities (id, instrument_key, kind, symbol, exchange, name, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, key, input.kind, symbol || null, exchange || null, name, input.currency, now, now],
  );
  return securityByKey(db, key)!;
}

// ---------------------------------------------------------------------------------------------
// Transactions

export type TransactionRecord = {
  id: string;
  accountId: string;
  securityId: string;
  type: TransactionType;
  tradeDate: string;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  withholdingTax: string;
  currency: string;
  taxFxRate: string;
  taxFxSource: string;
  notes: string | null;
  createdAt: number;
  security: Security;
};

export function toTransaction(row: Record<string, SqlValue>): TransactionRecord {
  return {
    id: str(row.id),
    accountId: str(row.account_id),
    securityId: str(row.security_id),
    type: str(row.type) as TransactionType,
    tradeDate: str(row.trade_date),
    quantity: strOrNull(row.quantity),
    price: strOrNull(row.price),
    amount: str(row.amount),
    fee: str(row.fee),
    withholdingTax: str(row.withholding_tax),
    currency: str(row.currency),
    taxFxRate: str(row.tax_fx_rate),
    taxFxSource: str(row.tax_fx_source),
    notes: strOrNull(row.notes),
    createdAt: Number(row.created_at),
    security: {
      id: str(row.security_id),
      instrumentKey: str(row.s_instrument_key),
      kind: str(row.s_kind) as SecurityKind,
      symbol: strOrNull(row.s_symbol),
      exchange: strOrNull(row.s_exchange),
      name: str(row.s_name),
      currency: str(row.s_currency),
    },
  };
}

/** Selects transactions joined with their security, in the shape toTransaction reads. */
export const TRANSACTION_SELECT = `SELECT t.*, s.instrument_key AS s_instrument_key, s.kind AS s_kind, s.symbol AS s_symbol,
       s.exchange AS s_exchange, s.name AS s_name, s.currency AS s_currency
FROM transactions t JOIN securities s ON s.id = t.security_id`;

export function listAccountTransactions(db: SqlConnection, accountId: string): TransactionRecord[] {
  return db
    .all(`${TRANSACTION_SELECT} WHERE t.account_id = ? ORDER BY t.trade_date, t.created_at, t.id`, [accountId])
    .map(toTransaction);
}

/** Converts stored transactions into the calculation's input. */
export function toTransactionInputs(records: TransactionRecord[]): TransactionInput[] {
  return records.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    securityId: t.securityId,
    securityIsCash: t.security.kind === 'cash',
    securityCurrency: t.security.currency,
    type: t.type,
    tradeDate: t.tradeDate,
    quantity: t.quantity,
    price: t.price,
    amount: t.amount,
    fee: t.fee,
    withholdingTax: t.withholdingTax,
    currency: t.currency,
    createdAt: t.createdAt,
  }));
}

/** Maps each currency to the account's cash security id, falling back to the instrument key. */
export function cashSecurityResolver(records: TransactionRecord[]): (currency: string) => string {
  const byCurrency = new Map<string, string>();
  for (const t of records) {
    if (t.security.kind === 'cash') byCurrency.set(t.security.currency, t.securityId);
  }
  return (currency) => byCurrency.get(currency) ?? cashInstrumentKey(currency);
}

const CASH_TYPES: TransactionType[] = ['deposit', 'withdrawal'];
const QUANTITY_TYPES: TransactionType[] = ['buy', 'sell', 'transfer_in', 'transfer_out', 'split'];

export type NewTransaction = {
  accountId: string;
  type: TransactionType;
  /** The security, or omitted for cash-only transactions (deposit, withdrawal, account fee, interest on cash). */
  securityId?: string;
  tradeDate: string;
  quantity?: string;
  price?: string;
  amount: string;
  fee?: string;
  withholdingTax?: string;
  /** Required for cash-only transactions; otherwise the security's currency is used. */
  currency?: string;
  /** Units of CAD per one unit of the transaction currency on the trade date. Required when not CAD. */
  taxFxRate?: string;
  notes?: string;
};

type TransactionRowInput = {
  accountId: string;
  securityId: string;
  type: TransactionType;
  tradeDate: string;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  withholdingTax: string;
  currency: string;
  taxFxRate: string | null;
  notes: string | null;
};

function insertTransactionRow(db: SqlConnection, row: TransactionRowInput, now: number): string {
  const id = uuidv7(now);
  const sameCurrency = row.currency === CA_TAX_CURRENCY;
  const taxFxRate = sameCurrency ? '1' : row.taxFxRate;
  if (!taxFxRate) invalid(`Enter the ${row.currency} to ${CA_TAX_CURRENCY} exchange rate on the trade date.`);
  db.run(
    `INSERT INTO transactions (id, account_id, security_id, type, trade_date, quantity, price, amount, fee,
       withholding_tax, currency, tax_fx_rate, tax_fx_source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, row.accountId, row.securityId, row.type, row.tradeDate, row.quantity, row.price, row.amount, row.fee,
      row.withholdingTax, row.currency, taxFxRate, sameCurrency ? 'same_currency' : 'manual', row.notes, now, now,
    ],
  );
  return id;
}

function optionalDecimal(value: string | undefined, label: string): string | null {
  const text = value?.trim() ?? '';
  if (text === '') return null;
  if (!isDecimalString(text)) invalid(`${label} must be a number like 10 or 54.07 (no commas or currency signs).`);
  return text;
}

/** Problems the given transactions produce, keyed by transaction id. */
function problemsById(records: TransactionInput[], cashId: (currency: string) => string): Map<string, string> {
  const { problems } = computePositions(records, { cashSecurityId: cashId });
  return new Map(problems.map((p) => [p.transactionId, p.message]));
}

/**
 * Validates and saves a transaction. The account's positions are recalculated with it first,
 * so e.g. selling more than is held on that date is refused before anything is saved.
 */
export function addTransaction(db: SqlConnection, input: NewTransaction, now: number): TransactionRecord {
  const account = getAccount(db, input.accountId);
  if (!account) invalid('That account no longer exists.');
  if (!isIsoDate(input.tradeDate)) invalid('Enter the trade date.');

  const amount = optionalDecimal(input.amount, 'Amount') ?? invalid('Enter the amount.');
  if (amount.startsWith('-')) invalid('Enter the amount as a positive number; the type sets the direction.');
  const quantity = optionalDecimal(input.quantity, input.type === 'split' ? 'Split ratio' : 'Quantity');
  const price = optionalDecimal(input.price, 'Price');
  const fee = optionalDecimal(input.fee, 'Fee') ?? '0';
  const withholdingTax = optionalDecimal(input.withholdingTax, 'Withholding tax') ?? '0';
  const taxFxRate = optionalDecimal(input.taxFxRate, 'Exchange rate');
  if (taxFxRate !== null && !Decimal.parse(taxFxRate).greaterThan(Decimal.ZERO)) invalid('The exchange rate must be greater than zero.');
  if (QUANTITY_TYPES.includes(input.type) && quantity === null) {
    invalid(input.type === 'split' ? 'Enter the split ratio (2 for a 2-for-1 split).' : 'Enter the quantity.');
  }

  return withTransaction(db, () => {
    let securityId = input.securityId;
    let currency: string;
    if (!securityId) {
      if (!input.currency || !isCurrencyCode(input.currency)) invalid('Choose the currency.');
      currency = input.currency;
      securityId = ensureCashSecurity(db, currency, now).id;
    } else {
      const security = db.all(`SELECT ${SECURITY_COLUMNS} FROM securities WHERE id = ?`, [securityId])[0];
      if (!security) invalid('Choose a security.');
      const sec = toSecurity(security);
      currency = sec.currency;
      if (CASH_TYPES.includes(input.type) && sec.kind !== 'cash') invalid('Deposits and withdrawals are recorded against cash.');
    }

    const existing = listAccountTransactions(db, account.id);
    const id = insertTransactionRow(db, {
      accountId: account.id, securityId, type: input.type, tradeDate: input.tradeDate, quantity, price, amount, fee,
      withholdingTax, currency, taxFxRate, notes: input.notes?.trim() || null,
    }, now);

    const after = listAccountTransactions(db, account.id);
    const before = problemsById(toTransactionInputs(existing), cashSecurityResolver(existing));
    const problems = problemsById(toTransactionInputs(after), cashSecurityResolver(after));
    const newProblem = problems.get(id) ?? [...problems.entries()].find(([txnId]) => !before.has(txnId))?.[1];
    if (newProblem) invalid(newProblem);

    return after.find((t) => t.id === id)!;
  });
}

/** Deletes a transaction, unless that would break later ones (e.g. a sale of shares no longer bought). */
export function deleteTransaction(db: SqlConnection, id: string): void {
  const row = db.all('SELECT account_id FROM transactions WHERE id = ?', [id])[0];
  if (!row) return;
  const accountId = str(row.account_id);
  withTransaction(db, () => {
    const existing = listAccountTransactions(db, accountId);
    db.run('DELETE FROM transactions WHERE id = ?', [id]);
    const after = listAccountTransactions(db, accountId);
    const before = problemsById(toTransactionInputs(existing), cashSecurityResolver(existing));
    const problems = problemsById(toTransactionInputs(after), cashSecurityResolver(after));
    const newProblem = [...problems.entries()].find(([txnId]) => !before.has(txnId));
    if (newProblem) invalid(`Can’t delete this: a later transaction depends on it. ${newProblem[1]}`);
  });
}
