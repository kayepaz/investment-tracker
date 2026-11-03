import { beforeEach, describe, expect, it } from 'vitest';
import { computePositions } from '../holdings/positions';
import { migrate } from './migrate';
import { USER_MIGRATIONS } from './migrations/user';
import {
  ValidationError,
  addTransaction,
  cashSecurityResolver,
  createAccount,
  deleteTransaction,
  findOrCreateSecurity,
  getSetting,
  listAccountTransactions,
  listAccounts,
  listSecurities,
  setSetting,
  toTransactionInputs,
} from './repo';
import { openTestDb, type TestDb } from './testing';

const NOW = 1_762_100_000_000;

function positionsOf(db: TestDb, accountId: string) {
  const records = listAccountTransactions(db, accountId);
  return computePositions(toTransactionInputs(records), { cashSecurityId: cashSecurityResolver(records) });
}

describe('repository', () => {
  let db: TestDb;
  beforeEach(() => {
    db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
  });

  it('stores and updates settings', () => {
    expect(getSetting(db, 'native_currency')).toBeNull();
    setSetting(db, 'native_currency', 'CAD', NOW);
    setSetting(db, 'native_currency', 'USD', NOW + 1);
    expect(getSetting(db, 'native_currency')).toBe('USD');
  });

  it('creates an account with an opening cash balance', () => {
    const account = createAccount(
      db,
      { name: ' Questrade TFSA ', accountType: 'tfsa', currency: 'CAD', openedDate: '2026-11-02', openingCash: '1500.00' },
      NOW,
    );
    expect(account.name).toBe('Questrade TFSA');
    expect(listAccounts(db)).toHaveLength(1);
    const { positions } = positionsOf(db, account.id);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.isCash).toBe(true);
    expect(positions[0]!.quantity.toString()).toBe('1500.00');
  });

  it('creates an account without opening cash', () => {
    const account = createAccount(db, { name: 'RRSP', accountType: 'rrsp', currency: 'CAD', openedDate: '2026-11-02' }, NOW);
    expect(listAccountTransactions(db, account.id)).toEqual([]);
  });

  it('validates new accounts', () => {
    const base = { name: 'A', accountType: 'tfsa', currency: 'CAD', openedDate: '2026-11-02' };
    expect(() => createAccount(db, { ...base, name: '  ' }, NOW)).toThrow(ValidationError);
    expect(() => createAccount(db, { ...base, accountType: 'savings' }, NOW)).toThrow(ValidationError);
    expect(() => createAccount(db, { ...base, openedDate: '02/11/2026' }, NOW)).toThrow(ValidationError);
    expect(() => createAccount(db, { ...base, openingCash: '1,500' }, NOW)).toThrow(ValidationError);
    expect(() => createAccount(db, { ...base, currency: 'USD', openingCash: '100' }, NOW)).toThrow(/exchange rate/);
    expect(listAccounts(db)).toEqual([]);
  });

  it('needs an exchange rate for non-CAD opening cash, and stores it', () => {
    const account = createAccount(
      db,
      { name: 'US', accountType: 'non_registered', currency: 'USD', openedDate: '2026-11-02', openingCash: '100', openingCashFxRate: '1.3978' },
      NOW,
    );
    expect(listAccountTransactions(db, account.id)[0]!.taxFxRate).toBe('1.3978');
  });

  it('finds an existing listed security instead of duplicating it', () => {
    const input = { kind: 'etf' as const, symbol: 'xiu', exchange: 'xtse', name: 'iShares S&P/TSX 60', currency: 'CAD' };
    const first = findOrCreateSecurity(db, input, NOW);
    const second = findOrCreateSecurity(db, { ...input, symbol: 'XIU' }, NOW + 1);
    expect(second.id).toBe(first.id);
    expect(first.instrumentKey).toBe('XTSE:XIU');
  });

  it('gives each unlisted security its own record', () => {
    const house = findOrCreateSecurity(db, { kind: 'real_estate', name: 'Cabin', currency: 'CAD' }, NOW);
    expect(house.instrumentKey.startsWith('USER:')).toBe(true);
    expect(listSecurities(db)).toHaveLength(1);
  });

  describe('transactions', () => {
    let accountId: string;
    let xiuId: string;

    beforeEach(() => {
      accountId = createAccount(
        db,
        { name: 'TFSA', accountType: 'tfsa', currency: 'CAD', openedDate: '2026-01-01', openingCash: '1000' },
        NOW,
      ).id;
      xiuId = findOrCreateSecurity(db, { kind: 'etf', symbol: 'XIU', exchange: 'XTSE', name: 'XIU', currency: 'CAD' }, NOW).id;
    });

    it('records a buy and takes cash out automatically', () => {
      addTransaction(
        db,
        { accountId, type: 'buy', securityId: xiuId, tradeDate: '2026-01-05', quantity: '10', price: '54.07', amount: '540.70', fee: '4.95' },
        NOW + 1,
      );
      const { positions } = positionsOf(db, accountId);
      const cash = positions.find((p) => p.isCash)!;
      expect(cash.quantity.toString()).toBe('454.35');
    });

    it('records deposits against cash without a security', () => {
      const record = addTransaction(db, { accountId, type: 'deposit', tradeDate: '2026-01-02', amount: '250', currency: 'CAD' }, NOW + 1);
      expect(record.security.kind).toBe('cash');
      expect(record.taxFxSource).toBe('same_currency');
    });

    it('refuses a sale of more than is held, saving nothing', () => {
      addTransaction(db, { accountId, type: 'buy', securityId: xiuId, tradeDate: '2026-01-05', quantity: '5', amount: '250' }, NOW + 1);
      expect(() =>
        addTransaction(db, { accountId, type: 'sell', securityId: xiuId, tradeDate: '2026-01-06', quantity: '6', amount: '330' }, NOW + 2),
      ).toThrow(/only 5 held/);
      expect(listAccountTransactions(db, accountId)).toHaveLength(2);
    });

    it('refuses a back-dated sale before the shares were bought', () => {
      addTransaction(db, { accountId, type: 'buy', securityId: xiuId, tradeDate: '2026-02-01', quantity: '5', amount: '250' }, NOW + 1);
      expect(() =>
        addTransaction(db, { accountId, type: 'sell', securityId: xiuId, tradeDate: '2026-01-15', quantity: '1', amount: '60' }, NOW + 2),
      ).toThrow(ValidationError);
    });

    it('validates amounts, quantities and dates with readable messages', () => {
      const buy = { accountId, type: 'buy' as const, securityId: xiuId, tradeDate: '2026-01-05', quantity: '1', amount: '50' };
      expect(() => addTransaction(db, { ...buy, amount: '$50' }, NOW)).toThrow(/number like/);
      expect(() => addTransaction(db, { ...buy, amount: '-50' }, NOW)).toThrow(/positive/);
      expect(() => addTransaction(db, { ...buy, quantity: '' }, NOW)).toThrow(/quantity/);
      expect(() => addTransaction(db, { ...buy, tradeDate: '' }, NOW)).toThrow(/trade date/);
    });

    it('needs an exchange rate for a US-dollar purchase and stores it', () => {
      const aaplId = findOrCreateSecurity(db, { kind: 'stock', symbol: 'AAPL', exchange: 'XNAS', name: 'Apple', currency: 'USD' }, NOW).id;
      const buy = { accountId, type: 'buy' as const, securityId: aaplId, tradeDate: '2026-01-05', quantity: '1', amount: '230' };
      expect(() => addTransaction(db, buy, NOW + 1)).toThrow(/exchange rate/);
      const record = addTransaction(db, { ...buy, taxFxRate: '1.3978' }, NOW + 2);
      expect(record.currency).toBe('USD');
      expect(record.taxFxRate).toBe('1.3978');
      expect(record.taxFxSource).toBe('manual');
    });

    it('refuses deposits recorded against a stock', () => {
      expect(() =>
        addTransaction(db, { accountId, type: 'deposit', securityId: xiuId, tradeDate: '2026-01-05', amount: '10' }, NOW),
      ).toThrow(ValidationError);
    });

    it('deletes a transaction, unless a later one depends on it', () => {
      const buy = addTransaction(db, { accountId, type: 'buy', securityId: xiuId, tradeDate: '2026-01-05', quantity: '5', amount: '250' }, NOW + 1);
      const sell = addTransaction(db, { accountId, type: 'sell', securityId: xiuId, tradeDate: '2026-01-06', quantity: '5', amount: '260' }, NOW + 2);
      expect(() => deleteTransaction(db, buy.id)).toThrow(/depends on it/);
      deleteTransaction(db, sell.id);
      deleteTransaction(db, buy.id);
      expect(listAccountTransactions(db, accountId)).toHaveLength(1);
    });
  });
});
