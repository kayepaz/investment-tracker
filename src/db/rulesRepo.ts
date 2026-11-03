// Rules, tags and responses to warnings. User database.

import { RuleParamsError, tagsUsedBy, validateRuleParams, type Rule, type RuleKind } from '../rules/types';
import { isIsoDate, uuidv7 } from './conventions';
import type { SqlConnection, SqlValue } from './migrate';
import { ValidationError, getSetting, setSetting, withTransaction } from './repo';

function invalid(message: string): never {
  throw new ValidationError(message);
}

const str = (value: SqlValue | undefined): string => (value === null || value === undefined ? '' : String(value));

// ---------------------------------------------------------------------------------------------
// Tags

export type Tag = { id: string; name: string };

export const STARTER_TAGS = ['Equity', 'Fixed income', 'Cash', 'Real estate', 'Canada', 'US', 'International'];
const TAGS_SEEDED = 'tags_seeded';

/** All tags. The first time, a starter set is created (once only, so deleting them all is respected). */
export function listTags(db: SqlConnection, now: number): Tag[] {
  if (getSetting(db, TAGS_SEEDED) === null) {
    withTransaction(db, () => {
      for (const name of STARTER_TAGS) {
        db.run('INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)', [uuidv7(now), name, now]);
      }
      setSetting(db, TAGS_SEEDED, '1', now);
    });
  }
  return db.all('SELECT id, name FROM tags ORDER BY name COLLATE NOCASE').map((row) => ({ id: str(row.id), name: str(row.name) }));
}

function cleanTagName(db: SqlConnection, name: string, exceptId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) invalid('Give the tag a name.');
  const clash = db.all('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [trimmed])[0];
  if (clash && str(clash.id) !== exceptId) invalid(`There’s already a tag called “${trimmed}”.`);
  return trimmed;
}

export function createTag(db: SqlConnection, name: string, now: number): Tag {
  const clean = cleanTagName(db, name);
  const id = uuidv7(now);
  db.run('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)', [id, clean, now]);
  return { id, name: clean };
}

export function renameTag(db: SqlConnection, id: string, name: string): void {
  db.run('UPDATE tags SET name = ? WHERE id = ?', [cleanTagName(db, name, id), id]);
}

export function deleteTag(db: SqlConnection, id: string): void {
  const usedBy = listRules(db).filter((rule) => tagsUsedBy(rule).includes(id));
  if (usedBy.length > 0) invalid(`This tag is used by the rule “${usedBy[0]!.name}”. Change or delete that rule first.`);
  db.run('DELETE FROM tags WHERE id = ?', [id]);
}

/** Every security's tag ids. */
export function listSecurityTags(db: SqlConnection): { securityId: string; tagId: string }[] {
  return db.all('SELECT security_id, tag_id FROM security_tags').map((row) => ({ securityId: str(row.security_id), tagId: str(row.tag_id) }));
}

export function setSecurityTags(db: SqlConnection, securityId: string, tagIds: string[]): void {
  withTransaction(db, () => {
    db.run('DELETE FROM security_tags WHERE security_id = ?', [securityId]);
    for (const tagId of new Set(tagIds)) {
      db.run('INSERT INTO security_tags (security_id, tag_id) VALUES (?, ?)', [securityId, tagId]);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Rules

function toRule(row: Record<string, SqlValue>): Rule {
  const kind = str(row.kind) as RuleKind;
  return {
    id: str(row.id),
    kind,
    name: str(row.name),
    scopeBucketId: row.scope_bucket_id === null || row.scope_bucket_id === undefined ? null : str(row.scope_bucket_id),
    params: JSON.parse(str(row.params)) as Rule['params'],
    enabled: Number(row.enabled) === 1,
  };
}

export function listRules(db: SqlConnection): Rule[] {
  return db.all('SELECT id, kind, name, scope_bucket_id, params, enabled FROM rules ORDER BY created_at').map(toRule);
}

export type RuleInput = { kind: RuleKind; name: string; scopeBucketId: string | null; params: unknown };

function checkRule(db: SqlConnection, input: RuleInput) {
  const name = input.name.trim();
  if (!name) invalid('Give the rule a name.');
  if (input.scopeBucketId !== null && !db.all('SELECT id FROM buckets WHERE id = ?', [input.scopeBucketId])[0]) {
    invalid('That bucket no longer exists.');
  }
  let params;
  try {
    params = validateRuleParams(input.kind, input.params);
  } catch (error) {
    if (error instanceof RuleParamsError) invalid(error.message);
    throw error;
  }
  const knownTags = new Set(db.all('SELECT id FROM tags').map((row) => str(row.id)));
  if (tagsUsedBy({ kind: input.kind, params }).some((tagId) => !knownTags.has(tagId))) invalid('One of the chosen tags no longer exists.');
  return { name, params };
}

export function createRule(db: SqlConnection, input: RuleInput, now: number): Rule {
  const { name, params } = checkRule(db, input);
  const id = uuidv7(now);
  db.run(
    `INSERT INTO rules (id, kind, name, scope_bucket_id, params, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, input.kind, name, input.scopeBucketId, JSON.stringify(params), now, now],
  );
  return listRules(db).find((r) => r.id === id)!;
}

export function updateRule(db: SqlConnection, id: string, input: RuleInput, now: number): void {
  const { name, params } = checkRule(db, input);
  db.run('UPDATE rules SET kind = ?, name = ?, scope_bucket_id = ?, params = ?, updated_at = ? WHERE id = ?', [
    input.kind,
    name,
    input.scopeBucketId,
    JSON.stringify(params),
    now,
    id,
  ]);
}

export function setRuleEnabled(db: SqlConnection, id: string, enabled: boolean, now: number): void {
  db.run('UPDATE rules SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, now, id]);
}

export function deleteRule(db: SqlConnection, id: string): void {
  db.run('DELETE FROM rules WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------------------------
// Responses to warnings

export type WarningResponse = {
  warningKey: string;
  response: 'acknowledged' | 'snoozed' | 'action_recorded';
  note: string | null;
  /** The warning is hidden through this date. */
  hiddenUntil: string | null;
  createdAt: number;
};

/** Days an acknowledged warning stays out of the badge counts. */
export const ACKNOWLEDGE_DAYS = 30;

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

export function respondToWarning(
  db: SqlConnection,
  input: { warningKey: string; response: 'acknowledged' | 'snoozed'; note?: string; snoozeUntil?: string; today: string },
  now: number,
): void {
  if (!input.warningKey) invalid('Unknown warning.');
  if (!isIsoDate(input.today)) invalid('Unknown date.');
  const until = input.response === 'acknowledged' ? addDays(input.today, ACKNOWLEDGE_DAYS) : input.snoozeUntil;
  if (!until || !isIsoDate(until) || until < input.today) invalid('Choose a date in the future.');
  db.run(
    `INSERT INTO warning_responses (id, warning_key, response, note, snooze_until, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv7(now), input.warningKey, input.response, input.note?.trim() || null, until, now],
  );
}

/** Lifts any hold on a warning so it shows again. */
export function unhideWarning(db: SqlConnection, warningKey: string, today: string, now: number): void {
  const yesterday = addDays(today, -1);
  db.run(`INSERT INTO warning_responses (id, warning_key, response, note, snooze_until, created_at) VALUES (?, ?, 'snoozed', ?, ?, ?)`, [
    uuidv7(now),
    warningKey,
    'Shown again',
    yesterday,
    now,
  ]);
}

/** The latest response per warning. */
export function latestWarningResponses(db: SqlConnection): WarningResponse[] {
  return db
    .all(
      `SELECT warning_key, response, note, snooze_until, created_at FROM warning_responses w
       WHERE created_at = (SELECT max(created_at) FROM warning_responses WHERE warning_key = w.warning_key)`,
    )
    .map((row) => ({
      warningKey: str(row.warning_key),
      response: str(row.response) as WarningResponse['response'],
      note: row.note === null ? null : str(row.note),
      hiddenUntil: row.snooze_until === null ? null : str(row.snooze_until),
      createdAt: Number(row.created_at),
    }));
}
