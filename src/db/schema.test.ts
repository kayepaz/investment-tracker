import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from './conventions';
import { migrate } from './migrate';
import { CACHE_MIGRATIONS } from './migrations/cache';
import { USER_MIGRATIONS } from './migrations/user';
import { openTestDb, type TestDb } from './testing';

const NOW = 1_762_100_000_000;

function addAccount(db: TestDb, id = uuidv7()): string {
  db.run(
    `INSERT INTO accounts (id, name, account_type, currency, created_at, updated_at)
     VALUES (?, 'Questrade TFSA', 'tfsa', 'CAD', ?, ?)`,
    [id, NOW, NOW],
  );
  return id;
}

function addSecurity(db: TestDb, key = 'XTSE:XIU', id = uuidv7()): string {
  db.run(
    `INSERT INTO securities (id, instrument_key, kind, symbol, exchange, name, currency, created_at, updated_at)
     VALUES (?, ?, 'etf', 'XIU', 'XTSE', 'iShares S&P/TSX 60', 'CAD', ?, ?)`,
    [id, key, NOW, NOW],
  );
  return id;
}

function addTransaction(db: TestDb, accountId: string, securityId: string, overrides: Record<string, string> = {}) {
  const row = {
    type: 'buy',
    trade_date: '2026-11-02',
    quantity: '10',
    price: '54.07',
    amount: '540.70',
    currency: 'CAD',
    tax_fx_rate: '1',
    tax_fx_source: 'same_currency',
    ...overrides,
  };
  db.run(
    `INSERT INTO transactions (id, account_id, security_id, type, trade_date, quantity, price, amount, currency,
       tax_fx_rate, tax_fx_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv7(),
      accountId,
      securityId,
      row.type,
      row.trade_date,
      row.quantity,
      row.price,
      row.amount,
      row.currency,
      row.tax_fx_rate,
      row.tax_fx_source,
      NOW,
      NOW,
    ],
  );
}

describe('user database schema', () => {
  let db: TestDb;
  beforeEach(() => {
    db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
  });

  it('stores a transaction for an account and security', () => {
    addTransaction(db, addAccount(db), addSecurity(db));
    expect(db.all('SELECT amount, price FROM transactions')).toEqual([{ amount: '540.70', price: '54.07' }]);
  });

  it('keeps decimal strings exactly as written', () => {
    addTransaction(db, addAccount(db), addSecurity(db), { price: '0.10', amount: '1.00' });
    expect(db.all('SELECT price, amount FROM transactions')).toEqual([{ price: '0.10', amount: '1.00' }]);
  });

  it('enforces foreign keys', () => {
    expect(() => addTransaction(db, uuidv7(), addSecurity(db))).toThrow(/FOREIGN KEY/);
  });

  it('will not delete an account that has transactions', () => {
    const accountId = addAccount(db);
    addTransaction(db, accountId, addSecurity(db));
    expect(() => db.run('DELETE FROM accounts WHERE id = ?', [accountId])).toThrow(/FOREIGN KEY/);
  });

  it('rejects badly formatted dates and currencies', () => {
    const accountId = addAccount(db);
    const securityId = addSecurity(db);
    expect(() => addTransaction(db, accountId, securityId, { trade_date: 'Nov 2 2026' })).toThrow(/CHECK/);
    expect(() => addTransaction(db, accountId, securityId, { currency: 'cad' })).toThrow(/CHECK/);
  });

  it('rejects unknown transaction types', () => {
    expect(() => addTransaction(db, addAccount(db), addSecurity(db), { type: 'gift' })).toThrow(/CHECK/);
  });

  it('rejects a number where text is required (STRICT tables)', () => {
    expect(() =>
      db.run(
        `INSERT INTO accounts (id, name, account_type, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv7(), 'x', 'tfsa', 'CAD', 'not a number', NOW],
      ),
    ).toThrow();
  });

  it('allows only one Unassigned bucket, at the top level', () => {
    const insertBucket = (name: string, unassigned: number, parent: string | null = null) =>
      db.run(
        `INSERT INTO buckets (id, parent_id, name, is_unassigned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv7(), parent, name, unassigned, NOW, NOW],
      );
    insertBucket('Unassigned', 1);
    expect(() => insertBucket('Unassigned again', 1)).toThrow(/UNIQUE/);
    const parent = uuidv7();
    db.run(`INSERT INTO buckets (id, name, created_at, updated_at) VALUES (?, 'Retirement', ?, ?)`, [parent, NOW, NOW]);
    insertBucket('TFSA', 0, parent);
    expect(db.all('SELECT count(*) AS n FROM buckets')).toEqual([{ n: 3 }]);
  });

  it('assigns each holding to one bucket', () => {
    const accountId = addAccount(db);
    const securityId = addSecurity(db);
    const bucketA = uuidv7();
    const bucketB = uuidv7();
    for (const id of [bucketA, bucketB]) {
      db.run(`INSERT INTO buckets (id, name, created_at, updated_at) VALUES (?, 'b', ?, ?)`, [id, NOW, NOW]);
    }
    const assign = (bucketId: string) =>
      db.run('INSERT INTO holding_buckets (account_id, security_id, bucket_id, updated_at) VALUES (?, ?, ?, ?)', [
        accountId,
        securityId,
        bucketId,
        NOW,
      ]);
    assign(bucketA);
    expect(() => assign(bucketB)).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it('requires rule params to be valid JSON', () => {
    const insertRule = (params: string) =>
      db.run(
        `INSERT INTO rules (id, kind, name, params, created_at, updated_at) VALUES (?, 'concentration', 'Max 20%', ?, ?, ?)`,
        [uuidv7(), params, NOW, NOW],
      );
    insertRule('{"maxPercent":"20"}');
    expect(() => insertRule('not json')).toThrow(/CHECK/);
  });

  it('requires a date when a warning is snoozed', () => {
    const respond = (response: string, until: string | null) =>
      db.run(
        `INSERT INTO warning_responses (id, warning_key, response, snooze_until, created_at) VALUES (?, 'k', ?, ?, ?)`,
        [uuidv7(), response, until, NOW],
      );
    respond('snoozed', '2026-12-01');
    expect(() => respond('snoozed', null)).toThrow(/CHECK/);
  });

  it('treats tag names case-insensitively', () => {
    const addTag = (name: string) => db.run('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)', [uuidv7(), name, NOW]);
    addTag('Equity');
    expect(() => addTag('equity')).toThrow(/UNIQUE/);
  });
});

describe('market cache schema', () => {
  it('stores prices and FX rates keyed independently of the user database', () => {
    const db = openTestDb();
    migrate(db, 'cache', CACHE_MIGRATIONS);
    db.run(
      `INSERT INTO prices (instrument_key, interval, price_date, close, currency, provider_id, fetched_at)
       VALUES ('XTSE:XIU', '1d', '2026-11-02', '54.0700', 'CAD', 'alphavantage', ?)`,
      [NOW],
    );
    db.run(
      `INSERT INTO fx_rates (base, quote, rate_date, rate, provider_id, fetched_at)
       VALUES ('USD', 'CAD', '2026-11-02', '1.3978', 'bank_of_canada', ?)`,
      [NOW],
    );
    expect(db.all('SELECT close FROM prices')).toEqual([{ close: '54.0700' }]);
    expect(db.all('SELECT rate FROM fx_rates')).toEqual([{ rate: '1.3978' }]);
  });

  it('keeps one price per instrument, interval and date', () => {
    const db = openTestDb();
    migrate(db, 'cache', CACHE_MIGRATIONS);
    const insert = () =>
      db.run(
        `INSERT INTO prices (instrument_key, interval, price_date, close, currency, provider_id, fetched_at)
         VALUES ('XTSE:XIU', '1d', '2026-11-02', '54.07', 'CAD', 'alphavantage', ?)`,
        [NOW],
      );
    insert();
    expect(insert).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
