import { describe, expect, it } from 'vitest';
import { dec } from '../money/decimal';
import { averageCost, computePositions, isOpen, type Position, type TransactionInput } from './positions';
import { convert, percentOf, valuePosition } from './valuation';

const ACCOUNT = 'acct-tfsa';
const XIU = 'sec-xiu';
const AAPL = 'sec-aapl';
const CASH_CAD = 'sec-cash-cad';
const CASH_USD = 'sec-cash-usd';
const cashSecurityId = (currency: string) => (currency === 'USD' ? CASH_USD : CASH_CAD);

let sequence = 0;
function txn(overrides: Partial<TransactionInput> & Pick<TransactionInput, 'type'>): TransactionInput {
  sequence += 1;
  return {
    id: `t${String(sequence).padStart(3, '0')}`,
    accountId: ACCOUNT,
    securityId: XIU,
    securityIsCash: false,
    securityCurrency: 'CAD',
    tradeDate: '2026-01-02',
    quantity: null,
    price: null,
    amount: '0',
    fee: '0',
    withholdingTax: '0',
    currency: 'CAD',
    createdAt: sequence,
    ...overrides,
  };
}

const cashTxn = (overrides: Partial<TransactionInput> & Pick<TransactionInput, 'type'>) =>
  txn({ securityId: CASH_CAD, securityIsCash: true, ...overrides });

function run(transactions: TransactionInput[]) {
  return computePositions(transactions, { cashSecurityId });
}

function find(positions: Position[], securityId: string): Position {
  const position = positions.find((p) => p.securityId === securityId);
  if (!position) throw new Error(`no position for ${securityId}`);
  return position;
}

const s = (value: { toString(): string }) => value.toString();

describe('computePositions: buying and selling', () => {
  it('takes the cost of a buy, including fees, out of cash', () => {
    const { positions, problems } = run([
      cashTxn({ type: 'deposit', amount: '1000.00' }),
      txn({ type: 'buy', quantity: '10', price: '54.07', amount: '540.70', fee: '4.95' }),
    ]);
    expect(problems).toEqual([]);
    const xiu = find(positions, XIU);
    expect(s(xiu.quantity)).toBe('10');
    expect(s(xiu.cost)).toBe('545.65');
    expect(s(find(positions, CASH_CAD).quantity)).toBe('454.35');
  });

  it('removes average cost on a partial sale and records the realized gain', () => {
    const { positions } = run([
      cashTxn({ type: 'opening_balance', amount: '2000' }),
      txn({ type: 'buy', quantity: '10', amount: '500', tradeDate: '2026-01-02' }),
      txn({ type: 'buy', quantity: '10', amount: '600', tradeDate: '2026-02-02' }),
      txn({ type: 'sell', quantity: '5', amount: '325', fee: '5', tradeDate: '2026-03-02' }),
    ]);
    const xiu = find(positions, XIU);
    expect(s(xiu.quantity)).toBe('15');
    // Average cost 55/unit: 5 units carry 275 of cost; proceeds 320 → gain 45.
    expect(s(xiu.cost.normalized())).toBe('825');
    expect(s(xiu.realizedGain.normalized())).toBe('45');
    expect(s(averageCost(xiu)!.normalized())).toBe('55');
    expect(s(find(positions, CASH_CAD).quantity)).toBe('1220');
  });

  it('removes the exact remaining cost when everything is sold', () => {
    const { positions } = run([
      txn({ type: 'opening_balance', quantity: '3', amount: '100' }),
      txn({ type: 'sell', quantity: '1', amount: '40' }),
      txn({ type: 'sell', quantity: '2', amount: '80' }),
    ]);
    const xiu = find(positions, XIU);
    expect(xiu.quantity.isZero()).toBe(true);
    expect(xiu.cost.isZero()).toBe(true);
    expect(isOpen(xiu)).toBe(false);
    expect(s(xiu.realizedGain.normalized())).toBe('20');
  });

  it('refuses to sell more than is held, and reports the problem', () => {
    const { positions, problems } = run([
      txn({ type: 'opening_balance', quantity: '5', amount: '250' }),
      txn({ type: 'sell', quantity: '6', amount: '300', id: 'oversell' }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.transactionId).toBe('oversell');
    expect(s(find(positions, XIU).quantity)).toBe('5');
    expect(positions.some((p) => p.securityId === CASH_CAD)).toBe(false);
  });

  it('applies transactions in date order, not entry order', () => {
    const { problems } = run([
      txn({ type: 'sell', quantity: '5', amount: '300', tradeDate: '2026-03-01' }),
      txn({ type: 'buy', quantity: '5', amount: '250', tradeDate: '2026-01-01' }),
    ]);
    expect(problems).toEqual([]);
  });
});

describe('computePositions: income and cash', () => {
  it('adds net dividends to income and to cash', () => {
    const { positions } = run([
      txn({ type: 'opening_balance', quantity: '100', amount: '5000' }),
      txn({ type: 'dividend', amount: '40.00', withholdingTax: '6.00' }),
    ]);
    expect(s(find(positions, XIU).income)).toBe('34.00');
    expect(s(find(positions, CASH_CAD).quantity)).toBe('34.00');
  });

  it('keeps cash separate per currency', () => {
    const { positions } = run([
      cashTxn({ type: 'deposit', amount: '1000' }),
      txn({
        type: 'buy',
        securityId: AAPL,
        securityCurrency: 'USD',
        currency: 'USD',
        quantity: '2',
        amount: '600',
      }),
    ]);
    expect(s(find(positions, CASH_CAD).quantity)).toBe('1000');
    expect(s(find(positions, CASH_USD).quantity)).toBe('-600');
    expect(find(positions, CASH_USD).currency).toBe('USD');
  });

  it('handles deposits, withdrawals and account fees on cash', () => {
    const { positions, problems } = run([
      cashTxn({ type: 'deposit', amount: '500' }),
      cashTxn({ type: 'withdrawal', amount: '100', fee: '1.50' }),
      cashTxn({ type: 'fee', amount: '2.00' }),
      cashTxn({ type: 'interest', amount: '0.75' }),
    ]);
    expect(problems).toEqual([]);
    const cash = find(positions, CASH_CAD);
    expect(s(cash.quantity)).toBe('397.25');
    expect(s(cash.cost)).toBe('397.25');
    expect(s(cash.income)).toBe('0.75');
  });

  it('refuses deposits against a security and buys of cash', () => {
    const { problems } = run([
      txn({ type: 'deposit', amount: '10' }),
      cashTxn({ type: 'buy', quantity: '1', amount: '10' }),
    ]);
    expect(problems).toHaveLength(2);
  });
});

describe('computePositions: other events', () => {
  it('reduces cost on return of capital, and counts any excess as a gain', () => {
    const { positions } = run([
      txn({ type: 'opening_balance', quantity: '10', amount: '100' }),
      txn({ type: 'return_of_capital', amount: '30' }),
      txn({ type: 'return_of_capital', amount: '80' }),
    ]);
    const xiu = find(positions, XIU);
    expect(xiu.cost.isZero()).toBe(true);
    expect(s(xiu.realizedGain)).toBe('10');
    expect(s(find(positions, CASH_CAD).quantity)).toBe('110');
  });

  it('applies a split to quantity but not cost', () => {
    const { positions } = run([
      txn({ type: 'opening_balance', quantity: '10', amount: '500' }),
      txn({ type: 'split', quantity: '2', amount: '0' }),
    ]);
    const xiu = find(positions, XIU);
    expect(s(xiu.quantity)).toBe('20');
    expect(s(xiu.cost)).toBe('500');
    expect(s(averageCost(xiu)!.normalized())).toBe('25');
  });

  it('moves units and cost on transfers without touching cash', () => {
    const { positions } = run([
      txn({ type: 'transfer_in', quantity: '10', amount: '400' }),
      txn({ type: 'transfer_out', quantity: '4', amount: '0' }),
    ]);
    const xiu = find(positions, XIU);
    expect(s(xiu.quantity)).toBe('6');
    expect(s(xiu.cost.normalized())).toBe('240');
    expect(positions.some((p) => p.securityId === CASH_CAD)).toBe(false);
  });
});

describe('computePositions: validation', () => {
  it('reports invalid decimals, missing quantities and negative amounts', () => {
    const { problems } = run([
      txn({ type: 'buy', quantity: '1', amount: '1e3' }),
      txn({ type: 'buy', quantity: null, amount: '10' }),
      txn({ type: 'buy', quantity: '1', amount: '-10' }),
      txn({ type: 'buy', quantity: '0', amount: '10' }),
    ]);
    expect(problems).toHaveLength(4);
  });

  it('reports a currency that differs from the security’s', () => {
    const { problems } = run([txn({ type: 'buy', quantity: '1', amount: '10', currency: 'USD' })]);
    expect(problems[0]!.message).toMatch(/differs/);
  });
});

describe('valuation', () => {
  const position = (): Position => {
    const { positions } = run([
      txn({ type: 'opening_balance', quantity: '10', amount: '500' }),
      txn({ type: 'dividend', amount: '12.50' }),
    ]);
    return find(positions, XIU);
  };

  it('values a position with change since purchase and gain including income', () => {
    const valuation = valuePosition(position(), dec('54.07'))!;
    expect(s(valuation.marketValue)).toBe('540.70');
    expect(s(valuation.changePercent!)).toBe('8.1400');
    expect(s(valuation.gainLoss)).toBe('53.20');
  });

  it('returns null without a price, except for cash', () => {
    expect(valuePosition(position(), null)).toBeNull();
    const cash = find(run([cashTxn({ type: 'deposit', amount: '100' })]).positions, CASH_CAD);
    expect(s(valuePosition(cash, null)!.marketValue)).toBe('100');
    expect(s(valuePosition(cash, null)!.gainLoss)).toBe('0');
  });

  it('converts currencies and computes shares of a total', () => {
    expect(s(convert(dec('100'), dec('1.3978')))).toBe('139.7800');
    expect(s(percentOf(dec('25'), dec('200'))!)).toBe('12.5000');
    expect(percentOf(dec('1'), dec('0'))).toBeNull();
  });
});
