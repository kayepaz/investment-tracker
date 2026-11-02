import { describe, expect, it } from 'vitest';
import {
  APPLICATION_IDS,
  NewerSchemaError,
  WrongDatabaseError,
  assertMigrationsValid,
  currentVersion,
  migrate,
} from './migrate';
import { CACHE_MIGRATIONS } from './migrations/cache';
import { USER_MIGRATIONS } from './migrations/user';
import { openTestDb } from './testing';

describe('migrate', () => {
  it('brings a new user database to the latest version and marks it', () => {
    const db = openTestDb();
    expect(migrate(db, 'user', USER_MIGRATIONS)).toEqual({ kind: 'user', from: 0, to: USER_MIGRATIONS.length });
    expect(currentVersion(db)).toBe(USER_MIGRATIONS.length);
    expect(Number(db.queryValue('PRAGMA application_id'))).toBe(APPLICATION_IDS.user);
  });

  it('brings a new cache database to the latest version', () => {
    const db = openTestDb();
    expect(migrate(db, 'cache', CACHE_MIGRATIONS).to).toBe(CACHE_MIGRATIONS.length);
    expect(Number(db.queryValue('PRAGMA application_id'))).toBe(APPLICATION_IDS.cache);
  });

  it('does nothing on a second run', () => {
    const db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
    const second = migrate(db, 'user', USER_MIGRATIONS);
    expect(second.from).toBe(second.to);
    expect(Number(db.queryValue('SELECT count(*) FROM schema_migrations'))).toBe(USER_MIGRATIONS.length);
  });

  it('refuses to treat a cache database as a user database', () => {
    const db = openTestDb();
    migrate(db, 'cache', CACHE_MIGRATIONS);
    expect(() => migrate(db, 'user', USER_MIGRATIONS)).toThrow(WrongDatabaseError);
  });

  it('refuses an unrelated non-empty database', () => {
    const db = openTestDb();
    db.execScript('CREATE TABLE something_else (x INTEGER)');
    expect(() => migrate(db, 'user', USER_MIGRATIONS)).toThrow(WrongDatabaseError);
  });

  it('refuses a database from a newer app version', () => {
    const db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
    db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [999, 'future', 0]);
    expect(() => migrate(db, 'user', USER_MIGRATIONS)).toThrow(NewerSchemaError);
  });

  it('rolls back a failing migration and keeps the previous version', () => {
    const db = openTestDb();
    const broken = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE a (x INTEGER) STRICT;' },
      { version: 2, name: 'broken', sql: 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;' },
    ];
    expect(() => migrate(db, 'user', broken)).toThrow();
    expect(currentVersion(db)).toBe(1);
    expect(Number(db.queryValue("SELECT count(*) FROM sqlite_master WHERE name = 'b'"))).toBe(0);
  });

  it('rejects migration lists with gaps', () => {
    expect(() => assertMigrationsValid([{ version: 2, name: 'x', sql: '' }])).toThrow();
  });
});
