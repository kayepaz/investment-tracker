// Buckets, which bucket each holding is in, and prices entered by hand. User database.

import { isDecimalString, isIsoDate, uuidv7 } from './conventions';
import type { SqlConnection, SqlValue } from './migrate';
import { TRANSACTION_SELECT, ValidationError, toTransaction, withTransaction, type TransactionRecord } from './repo';

function invalid(message: string): never {
  throw new ValidationError(message);
}

const str = (value: SqlValue | undefined): string => (value === null || value === undefined ? '' : String(value));

// ---------------------------------------------------------------------------------------------
// Buckets

export type Bucket = {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  isUnassigned: boolean;
};

function toBucket(row: Record<string, SqlValue>): Bucket {
  return {
    id: str(row.id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    name: str(row.name),
    sortOrder: Number(row.sort_order),
    isUnassigned: Number(row.is_unassigned) === 1,
  };
}

export const UNASSIGNED_NAME = 'Unassigned';

/** All buckets, with the built-in Unassigned bucket created on first use. */
export function listBuckets(db: SqlConnection, now: number): Bucket[] {
  ensureUnassignedBucket(db, now);
  return db
    .all('SELECT id, parent_id, name, sort_order, is_unassigned FROM buckets ORDER BY is_unassigned, sort_order, name COLLATE NOCASE')
    .map(toBucket);
}

export function ensureUnassignedBucket(db: SqlConnection, now: number): Bucket {
  const row = db.all('SELECT id, parent_id, name, sort_order, is_unassigned FROM buckets WHERE is_unassigned = 1')[0];
  if (row) return toBucket(row);
  const id = uuidv7(now);
  db.run(
    `INSERT INTO buckets (id, parent_id, name, sort_order, is_unassigned, created_at, updated_at)
     VALUES (?, NULL, ?, 0, 1, ?, ?)`,
    [id, UNASSIGNED_NAME, now, now],
  );
  return { id, parentId: null, name: UNASSIGNED_NAME, sortOrder: 0, isUnassigned: true };
}

function getBucket(db: SqlConnection, id: string): Bucket | null {
  const row = db.all('SELECT id, parent_id, name, sort_order, is_unassigned FROM buckets WHERE id = ?', [id])[0];
  return row ? toBucket(row) : null;
}

function holdingCount(db: SqlConnection, bucketId: string): number {
  return Number(db.all('SELECT count(*) AS n FROM holding_buckets WHERE bucket_id = ?', [bucketId])[0]?.n ?? 0);
}

function childCount(db: SqlConnection, bucketId: string): number {
  return Number(db.all('SELECT count(*) AS n FROM buckets WHERE parent_id = ?', [bucketId])[0]?.n ?? 0);
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) invalid('Give the bucket a name.');
  if (trimmed.toLowerCase() === UNASSIGNED_NAME.toLowerCase()) invalid('“Unassigned” is reserved for the built-in bucket.');
  return trimmed;
}

function checkParent(db: SqlConnection, parentId: string | null): void {
  if (parentId === null) return;
  const parent = getBucket(db, parentId);
  if (!parent) invalid('That parent bucket no longer exists.');
  if (parent.isUnassigned) invalid('Buckets can’t be placed inside Unassigned.');
  if (holdingCount(db, parentId) > 0) {
    invalid(`“${parent.name}” holds investments directly. Move them into a bucket first; only buckets without sub-buckets can hold investments.`);
  }
}

export function createBucket(db: SqlConnection, input: { name: string; parentId: string | null }, now: number): Bucket {
  const name = cleanName(input.name);
  checkParent(db, input.parentId);
  const id = uuidv7(now);
  const sortOrder = Number(
    db.all('SELECT coalesce(max(sort_order), 0) + 1 AS n FROM buckets WHERE parent_id IS ?', [input.parentId])[0]?.n ?? 1,
  );
  db.run(
    `INSERT INTO buckets (id, parent_id, name, sort_order, is_unassigned, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [id, input.parentId, name, sortOrder, now, now],
  );
  return getBucket(db, id)!;
}

export function renameBucket(db: SqlConnection, id: string, name: string, now: number): void {
  const bucket = getBucket(db, id);
  if (!bucket) invalid('That bucket no longer exists.');
  if (bucket.isUnassigned) invalid('The Unassigned bucket can’t be renamed.');
  db.run('UPDATE buckets SET name = ?, updated_at = ? WHERE id = ?', [cleanName(name), now, id]);
}

/** Moves a bucket under another (or to the top level), refusing loops. */
export function moveBucket(db: SqlConnection, id: string, parentId: string | null, now: number): void {
  const bucket = getBucket(db, id);
  if (!bucket) invalid('That bucket no longer exists.');
  if (bucket.isUnassigned) invalid('The Unassigned bucket stays at the top level.');
  checkParent(db, parentId);
  for (let ancestor = parentId; ancestor !== null; ancestor = getBucket(db, ancestor)?.parentId ?? null) {
    if (ancestor === id) invalid('A bucket can’t be placed inside itself or one of its own sub-buckets.');
  }
  db.run('UPDATE buckets SET parent_id = ?, updated_at = ? WHERE id = ?', [parentId, now, id]);
}

/** Deletes an empty bucket. Buckets with sub-buckets or investments must be emptied first. */
export function deleteBucket(db: SqlConnection, id: string): void {
  const bucket = getBucket(db, id);
  if (!bucket) return;
  if (bucket.isUnassigned) invalid('The Unassigned bucket can’t be deleted.');
  if (childCount(db, id) > 0) invalid(`“${bucket.name}” has sub-buckets. Move or delete them first.`);
  const holdings = holdingCount(db, id);
  if (holdings > 0) invalid(`“${bucket.name}” holds ${holdings} investment${holdings === 1 ? '' : 's'}. Move them to another bucket first.`);
  db.run('DELETE FROM buckets WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------------------------
// Holding assignments

export type HoldingAssignment = { accountId: string; securityId: string; bucketId: string };

export function listAssignments(db: SqlConnection): HoldingAssignment[] {
  return db.all('SELECT account_id, security_id, bucket_id FROM holding_buckets').map((row) => ({
    accountId: str(row.account_id),
    securityId: str(row.security_id),
    bucketId: str(row.bucket_id),
  }));
}

/** Puts a holding (a security within an account) into a bucket that has no sub-buckets. */
export function assignHolding(db: SqlConnection, input: HoldingAssignment, now: number): void {
  const bucket = getBucket(db, input.bucketId);
  if (!bucket) invalid('That bucket no longer exists.');
  if (childCount(db, input.bucketId) > 0) {
    invalid(`“${bucket.name}” has sub-buckets; choose one of them. Only buckets without sub-buckets hold investments.`);
  }
  withTransaction(db, () => {
    if (bucket.isUnassigned) {
      db.run('DELETE FROM holding_buckets WHERE account_id = ? AND security_id = ?', [input.accountId, input.securityId]);
      return;
    }
    db.run(
      `INSERT INTO holding_buckets (account_id, security_id, bucket_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (account_id, security_id) DO UPDATE SET bucket_id = excluded.bucket_id, updated_at = excluded.updated_at`,
      [input.accountId, input.securityId, input.bucketId, now],
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Manual prices

export type ManualPrice = { securityId: string; priceDate: string; price: string; currency: string };

/** Records a price typed in by hand for a security on a date (replacing one already set for that date). */
export function setManualPrice(db: SqlConnection, input: ManualPrice & { note?: string }, now: number): void {
  if (!isIsoDate(input.priceDate)) invalid('Enter the date of the price.');
  const price = input.price.trim();
  if (!isDecimalString(price) || price.startsWith('-')) invalid('Enter the price as a number like 54.07.');
  const security = db.all('SELECT currency, kind FROM securities WHERE id = ?', [input.securityId])[0];
  if (!security) invalid('That security no longer exists.');
  if (str(security.kind) === 'cash') invalid('Cash is always valued at face value.');
  db.run(
    `INSERT INTO manual_prices (id, security_id, price_date, price, currency, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (security_id, price_date) DO UPDATE SET price = excluded.price, note = excluded.note, created_at = excluded.created_at`,
    [uuidv7(now), input.securityId, input.priceDate, price, str(security.currency), input.note?.trim() || null, now],
  );
}

/** The most recent manual price per security. */
export function latestManualPrices(db: SqlConnection): ManualPrice[] {
  return db
    .all(
      `SELECT m.security_id, m.price_date, m.price, m.currency FROM manual_prices m
       WHERE m.price_date = (SELECT max(price_date) FROM manual_prices WHERE security_id = m.security_id)`,
    )
    .map((row) => ({
      securityId: str(row.security_id),
      priceDate: str(row.price_date),
      price: str(row.price),
      currency: str(row.currency),
    }));
}

// ---------------------------------------------------------------------------------------------
// All transactions, for the portfolio view

export function listAllTransactions(db: SqlConnection): TransactionRecord[] {
  return db.all(`${TRANSACTION_SELECT} ORDER BY t.account_id, t.trade_date, t.created_at, t.id`).map(toTransaction);
}
