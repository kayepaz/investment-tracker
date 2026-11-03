// Positions (holdings) derived from an account's transactions, with automatic cash.
//
// A position is a security within an account. Its quantity, cost and income come only from
// transactions; nothing here is stored. Cost is the average cost in the security's currency,
// including purchase fees. This is the per-account cost used for "change since purchase" and
// stop losses; tax cost basis (pooled ACB in CAD) is calculated separately by the tax plug-in.
//
// Cash is automatic: a buy takes its cost (plus fees) out of the account's cash in the
// transaction currency, a sell or dividend puts money back, and so on. See docs/transactions.md.

import { Decimal } from '../money/decimal';

export type TransactionType =
  | 'opening_balance'
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'interest'
  | 'distribution'
  | 'return_of_capital'
  | 'deposit'
  | 'withdrawal'
  | 'fee'
  | 'transfer_in'
  | 'transfer_out'
  | 'split';

/** A transaction as stored (decimal strings), plus what we need to know about its security. */
export type TransactionInput = {
  id: string;
  accountId: string;
  securityId: string;
  /** True when the security is a cash holding (kind 'cash'). */
  securityIsCash: boolean;
  securityCurrency: string;
  type: TransactionType;
  tradeDate: string;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  withholdingTax: string;
  currency: string;
  /** Tie-breaker for transactions on the same date. */
  createdAt: number;
};

export type Position = {
  accountId: string;
  securityId: string;
  isCash: boolean;
  currency: string;
  /** Units held; for cash, the balance. */
  quantity: Decimal;
  /** Total cost of the units held, in `currency`. For cash, equal to the balance. */
  cost: Decimal;
  /** Net income received while holding it (dividends, interest, distributions, after withholding and fees). */
  income: Decimal;
  /** Gains realized by selling, and by return of capital beyond cost. */
  realizedGain: Decimal;
  firstTradeDate: string;
};

export type PositionProblem = {
  transactionId: string;
  message: string;
};

export type PositionsResult = {
  positions: Position[];
  /** Transactions that could not be applied; they are skipped and reported. */
  problems: PositionProblem[];
};

export type PositionsOptions = {
  /** The cash security for an account's money in a currency (e.g. the 'CASH:CAD' security's id). */
  cashSecurityId: (currency: string) => string;
};

/** Average cost per unit is kept to this many decimal places when splitting cost on a sale. */
const COST_SCALE = 10;

class ProblemError extends Error {}

function fail(message: string): never {
  throw new ProblemError(message);
}

function parseRequired(value: string | null, field: string): Decimal {
  if (value === null || value === '') fail(`${field} is required`);
  try {
    return Decimal.parse(value);
  } catch {
    fail(`${field} is not a valid decimal: ${JSON.stringify(value)}`);
  }
}

function nonNegative(value: Decimal, field: string): Decimal {
  if (value.isNegative()) fail(`${field} must not be negative`);
  return value;
}

function positive(value: Decimal, field: string): Decimal {
  if (value.isNegative() || value.isZero()) fail(`${field} must be greater than zero`);
  return value;
}

export function sortTransactions(transactions: TransactionInput[]): TransactionInput[] {
  return [...transactions].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

export function computePositions(transactions: TransactionInput[], options: PositionsOptions): PositionsResult {
  const positions = new Map<string, Position>();
  const problems: PositionProblem[] = [];

  function positionFor(accountId: string, securityId: string, isCash: boolean, currency: string, date: string) {
    const key = `${accountId}|${securityId}`;
    let position = positions.get(key);
    if (!position) {
      position = {
        accountId,
        securityId,
        isCash,
        currency,
        quantity: Decimal.ZERO,
        cost: Decimal.ZERO,
        income: Decimal.ZERO,
        realizedGain: Decimal.ZERO,
        firstTradeDate: date,
      };
      positions.set(key, position);
    }
    return position;
  }

  for (const txn of sortTransactions(transactions)) {
    // Changes are staged and applied only if the whole transaction is valid.
    const changes: Array<() => void> = [];
    try {
      const amount = nonNegative(parseRequired(txn.amount, 'Amount'), 'Amount');
      const fee = nonNegative(parseRequired(txn.fee, 'Fee'), 'Fee');
      const withholding = nonNegative(parseRequired(txn.withholdingTax, 'Withholding tax'), 'Withholding tax');

      if (!txn.securityIsCash && txn.currency !== txn.securityCurrency) {
        fail(`Transaction currency ${txn.currency} differs from the security's currency ${txn.securityCurrency}`);
      }

      // The account's cash in the transaction currency.
      const cashId = txn.securityIsCash ? txn.securityId : options.cashSecurityId(txn.currency);
      const cash = () => positionFor(txn.accountId, cashId, true, txn.currency, txn.tradeDate);
      const moveCash = (delta: Decimal) =>
        changes.push(() => {
          const c = cash();
          c.quantity = c.quantity.plus(delta);
          c.cost = c.quantity;
        });

      const holding = () =>
        positionFor(txn.accountId, txn.securityId, txn.securityIsCash, txn.securityCurrency, txn.tradeDate);
      const current = positions.get(`${txn.accountId}|${txn.securityId}`);
      const heldQuantity = current?.quantity ?? Decimal.ZERO;
      const heldCost = current?.cost ?? Decimal.ZERO;

      const cashOnly = (verb: string) => {
        if (!txn.securityIsCash) fail(`A ${verb} must be recorded against a cash holding`);
      };
      const securityOnly = (verb: string) => {
        if (txn.securityIsCash) fail(`A ${verb} must be recorded against a security, not cash`);
      };
      /** Cost of `quantity` units at the current average cost; the whole cost when selling everything. */
      const costOf = (quantity: Decimal) =>
        quantity.equals(heldQuantity) ? heldCost : heldCost.times(quantity).dividedBy(heldQuantity, COST_SCALE);
      const requireHeld = (quantity: Decimal) => {
        if (quantity.greaterThan(heldQuantity)) {
          fail(`Can't remove ${quantity.toString()} units; only ${heldQuantity.toString()} held on this date`);
        }
      };

      switch (txn.type) {
        case 'opening_balance': {
          if (txn.securityIsCash) {
            moveCash(amount);
          } else {
            const quantity = positive(parseRequired(txn.quantity, 'Quantity'), 'Quantity');
            changes.push(() => {
              const h = holding();
              h.quantity = h.quantity.plus(quantity);
              h.cost = h.cost.plus(amount);
            });
          }
          break;
        }
        case 'buy': {
          securityOnly('buy');
          const quantity = positive(parseRequired(txn.quantity, 'Quantity'), 'Quantity');
          changes.push(() => {
            const h = holding();
            h.quantity = h.quantity.plus(quantity);
            h.cost = h.cost.plus(amount).plus(fee);
          });
          moveCash(amount.plus(fee).negated());
          break;
        }
        case 'sell': {
          securityOnly('sell');
          const quantity = positive(parseRequired(txn.quantity, 'Quantity'), 'Quantity');
          requireHeld(quantity);
          const removedCost = costOf(quantity);
          const proceeds = amount.minus(fee);
          changes.push(() => {
            const h = holding();
            h.quantity = h.quantity.minus(quantity);
            h.cost = h.cost.minus(removedCost);
            h.realizedGain = h.realizedGain.plus(proceeds.minus(removedCost));
          });
          moveCash(proceeds);
          break;
        }
        case 'dividend':
        case 'interest':
        case 'distribution': {
          const net = amount.minus(withholding).minus(fee);
          changes.push(() => {
            const h = holding();
            h.income = h.income.plus(net);
          });
          moveCash(net);
          break;
        }
        case 'return_of_capital': {
          securityOnly('return of capital');
          changes.push(() => {
            const h = holding();
            const newCost = h.cost.minus(amount);
            if (newCost.isNegative()) {
              h.realizedGain = h.realizedGain.plus(newCost.negated());
              h.cost = Decimal.ZERO;
            } else {
              h.cost = newCost;
            }
          });
          moveCash(amount.minus(fee));
          break;
        }
        case 'deposit': {
          cashOnly('deposit');
          moveCash(amount.minus(fee));
          break;
        }
        case 'withdrawal': {
          cashOnly('withdrawal');
          moveCash(amount.plus(fee).negated());
          break;
        }
        case 'fee': {
          // A fee recorded against a security also counts against that security's income.
          if (!txn.securityIsCash) {
            changes.push(() => {
              const h = holding();
              h.income = h.income.minus(amount);
            });
          }
          moveCash(amount.negated());
          break;
        }
        case 'transfer_in': {
          if (txn.securityIsCash) {
            moveCash(amount);
          } else {
            const quantity = positive(parseRequired(txn.quantity, 'Quantity'), 'Quantity');
            changes.push(() => {
              const h = holding();
              h.quantity = h.quantity.plus(quantity);
              h.cost = h.cost.plus(amount);
            });
          }
          break;
        }
        case 'transfer_out': {
          if (txn.securityIsCash) {
            moveCash(amount.negated());
          } else {
            const quantity = positive(parseRequired(txn.quantity, 'Quantity'), 'Quantity');
            requireHeld(quantity);
            const removedCost = costOf(quantity);
            changes.push(() => {
              const h = holding();
              h.quantity = h.quantity.minus(quantity);
              h.cost = h.cost.minus(removedCost);
            });
          }
          break;
        }
        case 'split': {
          securityOnly('split');
          // quantity holds the split ratio: '2' for a 2-for-1 split, '0.1' for a 1-for-10 consolidation.
          const ratio = positive(parseRequired(txn.quantity, 'Split ratio'), 'Split ratio');
          if (heldQuantity.isZero()) fail('Nothing held to split on this date');
          changes.push(() => {
            const h = holding();
            h.quantity = h.quantity.times(ratio);
          });
          break;
        }
        default: {
          const unknown: never = txn.type;
          fail(`Unknown transaction type ${String(unknown)}`);
        }
      }

      for (const apply of changes) apply();
    } catch (error) {
      if (!(error instanceof ProblemError)) throw error;
      problems.push({ transactionId: txn.id, message: error.message });
    }
  }

  const sorted = [...positions.values()].sort(
    (a, b) => a.accountId.localeCompare(b.accountId) || a.securityId.localeCompare(b.securityId),
  );
  return { positions: sorted, problems };
}

/** Average cost per unit, or null when nothing is held. */
export function averageCost(position: Position, scale = COST_SCALE): Decimal | null {
  if (position.quantity.isZero()) return null;
  return position.cost.dividedBy(position.quantity, scale);
}

export function isOpen(position: Position): boolean {
  return !position.quantity.isZero();
}
