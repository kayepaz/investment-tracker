import type { TransactionType } from '../holdings/positions';

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  interest: 'Interest',
  distribution: 'Distribution',
  return_of_capital: 'Return of capital',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  fee: 'Fee',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  split: 'Split',
  opening_balance: 'Opening balance',
};

/** The order types appear in the picker. */
export const TRANSACTION_TYPE_ORDER: TransactionType[] = [
  'buy',
  'sell',
  'dividend',
  'deposit',
  'withdrawal',
  'opening_balance',
  'interest',
  'distribution',
  'fee',
  'return_of_capital',
  'transfer_in',
  'transfer_out',
  'split',
];

/** Which fields each transaction type uses in the form. */
export type FormFields = {
  /** 'security' = a stock/ETF/…; 'cash' = cash only; 'either' = security or cash. */
  subject: 'security' | 'cash' | 'either';
  quantity: boolean;
  price: boolean;
  amount: boolean;
  fee: boolean;
  withholding: boolean;
};

export const FORM_FIELDS: Record<TransactionType, FormFields> = {
  buy: { subject: 'security', quantity: true, price: true, amount: true, fee: true, withholding: false },
  sell: { subject: 'security', quantity: true, price: true, amount: true, fee: true, withholding: false },
  dividend: { subject: 'security', quantity: false, price: false, amount: true, fee: false, withholding: true },
  distribution: { subject: 'security', quantity: false, price: false, amount: true, fee: false, withholding: true },
  interest: { subject: 'either', quantity: false, price: false, amount: true, fee: false, withholding: true },
  return_of_capital: { subject: 'security', quantity: false, price: false, amount: true, fee: true, withholding: false },
  deposit: { subject: 'cash', quantity: false, price: false, amount: true, fee: true, withholding: false },
  withdrawal: { subject: 'cash', quantity: false, price: false, amount: true, fee: true, withholding: false },
  fee: { subject: 'either', quantity: false, price: false, amount: true, fee: false, withholding: false },
  transfer_in: { subject: 'either', quantity: true, price: false, amount: true, fee: false, withholding: false },
  transfer_out: { subject: 'either', quantity: true, price: false, amount: true, fee: false, withholding: false },
  split: { subject: 'security', quantity: true, price: false, amount: false, fee: false, withholding: false },
  opening_balance: { subject: 'either', quantity: true, price: false, amount: true, fee: false, withholding: false },
};
