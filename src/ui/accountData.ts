import { db } from '../db/client';
import type { Account, Security, TransactionRecord } from '../db/repo';
import { cashSecurityResolver, toTransactionInputs } from '../db/repo';
import { computePositions, type Position, type PositionProblem } from '../holdings/positions';

export type AccountData = {
  account: Account;
  transactions: TransactionRecord[];
  positions: Position[];
  problems: PositionProblem[];
  securities: Map<string, Security>;
};

/** Loads an account with its transactions and works out its current positions. */
export async function loadAccount(accountId: string): Promise<AccountData | null> {
  const account = await db('getAccount', accountId);
  if (!account) return null;
  const transactions = await db('listAccountTransactions', accountId);
  const { positions, problems } = computePositions(toTransactionInputs(transactions), {
    cashSecurityId: cashSecurityResolver(transactions),
  });
  const securities = new Map(transactions.map((t) => [t.securityId, t.security]));
  return { account, transactions, positions, problems, securities };
}

export function securityLabel(security: Security | undefined): string {
  if (!security) return 'Unknown';
  if (security.kind === 'cash') return `Cash (${security.currency})`;
  return security.symbol ? `${security.symbol} · ${security.name}` : security.name;
}
