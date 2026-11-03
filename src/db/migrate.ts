// Schema migrations, shared by the user database and the market cache.
// Each database has its own ordered list of migrations and its own version.

export type Migration = {
  /** 1, 2, 3, … with no gaps. */
  version: number;
  name: string;
  sql: string;
};

export type SqlValue = string | number | null;

/** The few operations the runner needs, so it works with sqlite-wasm in the browser and node:sqlite in tests. */
export interface SqlConnection {
  /** Runs one or more statements with no parameters. */
  execScript(sql: string): void;
  /** Runs one statement with positional parameters. */
  run(sql: string, params: SqlValue[]): void;
  /** Returns the first column of the first row, or null when there are no rows. */
  queryValue(sql: string): unknown;
  /** Returns all rows as plain objects keyed by column name. */
  all(sql: string, params?: SqlValue[]): Record<string, SqlValue>[];
}

export type DatabaseKind = 'user' | 'cache';

/**
 * Stored in the SQLite header (PRAGMA application_id) so a user database can never be
 * mistaken for a cache database or for some other app's file, e.g. when restoring a backup.
 */
export const APPLICATION_IDS: Record<DatabaseKind, number> = {
  user: 0x49545553, // 'ITUS'
  cache: 0x49544341, // 'ITCA'
};

export class NewerSchemaError extends Error {
  constructor(
    readonly kind: DatabaseKind,
    readonly found: number,
    readonly supported: number,
  ) {
    super(`The ${kind} database is at schema version ${found}, but this app only supports up to ${supported}.`);
    this.name = 'NewerSchemaError';
  }
}

export class WrongDatabaseError extends Error {
  constructor(
    readonly expected: DatabaseKind,
    readonly applicationId: number,
  ) {
    super(`This file is not an Investment Tracker ${expected} database (application id ${applicationId}).`);
    this.name = 'WrongDatabaseError';
  }
}

export function assertMigrationsValid(migrations: Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration versions must be 1, 2, 3, … with no gaps; found ${migration.version} at position ${index + 1}`);
    }
  });
}

export function currentVersion(db: SqlConnection): number {
  const exists = db.queryValue("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  if (Number(exists) === 0) return 0;
  return Number(db.queryValue('SELECT coalesce(max(version), 0) FROM schema_migrations'));
}

export type MigrationResult = { kind: DatabaseKind; from: number; to: number };

/**
 * Brings a database up to the latest schema. Each migration runs in its own transaction.
 * Refuses a database from a newer app version, or one that belongs to something else.
 */
export function migrate(
  db: SqlConnection,
  kind: DatabaseKind,
  migrations: Migration[],
  now: () => number = Date.now,
): MigrationResult {
  assertMigrationsValid(migrations);
  db.execScript('PRAGMA foreign_keys = ON');

  const expectedId = APPLICATION_IDS[kind];
  const applicationId = Number(db.queryValue('PRAGMA application_id'));
  const from = currentVersion(db);

  if (applicationId !== expectedId) {
    const isEmpty = applicationId === 0 && from === 0 && Number(db.queryValue('SELECT count(*) FROM sqlite_master')) === 0;
    if (!isEmpty) throw new WrongDatabaseError(kind, applicationId);
    db.execScript(`PRAGMA application_id = ${expectedId}`);
  }

  const latest = migrations.length;
  if (from > latest) throw new NewerSchemaError(kind, from, latest);

  db.execScript(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  INTEGER NOT NULL
  ) STRICT`);

  for (const migration of migrations.slice(from)) {
    db.execScript('BEGIN');
    try {
      db.execScript(migration.sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        now(),
      ]);
      db.execScript('COMMIT');
    } catch (error) {
      db.execScript('ROLLBACK');
      throw error;
    }
  }

  return { kind, from, to: latest };
}
