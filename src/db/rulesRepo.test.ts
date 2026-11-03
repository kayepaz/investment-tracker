import { beforeEach, describe, expect, it } from 'vitest';
import { createBucket } from './bucketsRepo';
import { migrate } from './migrate';
import { USER_MIGRATIONS } from './migrations/user';
import { ValidationError, findOrCreateSecurity } from './repo';
import {
  STARTER_TAGS,
  addDays,
  createRule,
  createTag,
  deleteRule,
  deleteTag,
  latestWarningResponses,
  listRules,
  listSecurityTags,
  listTags,
  renameTag,
  respondToWarning,
  setRuleEnabled,
  setSecurityTags,
  unhideWarning,
  updateRule,
} from './rulesRepo';
import { openTestDb, type TestDb } from './testing';

const NOW = 1_762_100_000_000;

describe('tags', () => {
  let db: TestDb;
  beforeEach(() => {
    db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
  });

  it('starts with an editable starter set, created once', () => {
    expect(listTags(db, NOW).map((t) => t.name).sort()).toEqual([...STARTER_TAGS].sort());
    for (const tag of listTags(db, NOW)) deleteTag(db, tag.id);
    expect(listTags(db, NOW)).toEqual([]);
  });

  it('creates and renames tags, refusing duplicates', () => {
    listTags(db, NOW);
    const ai = createTag(db, ' AI theme ', NOW);
    expect(ai.name).toBe('AI theme');
    expect(() => createTag(db, 'ai THEME', NOW)).toThrow(/already/);
    expect(() => renameTag(db, ai.id, 'equity')).toThrow(/already/);
    renameTag(db, ai.id, 'Artificial intelligence');
    expect(listTags(db, NOW).some((t) => t.name === 'Artificial intelligence')).toBe(true);
  });

  it('tags securities', () => {
    const [equity, canada] = listTags(db, NOW).filter((t) => t.name === 'Equity' || t.name === 'Canada');
    const xiu = findOrCreateSecurity(db, { kind: 'etf', symbol: 'XIU', exchange: 'XTSE', name: 'XIU', currency: 'CAD' }, NOW);
    setSecurityTags(db, xiu.id, [equity!.id, canada!.id, equity!.id]);
    expect(listSecurityTags(db)).toHaveLength(2);
    setSecurityTags(db, xiu.id, [canada!.id]);
    expect(listSecurityTags(db)).toEqual([{ securityId: xiu.id, tagId: canada!.id }]);
  });

  it('won’t delete a tag a rule uses', () => {
    const equity = listTags(db, NOW).find((t) => t.name === 'Equity')!;
    createRule(db, { kind: 'concentration', name: 'Equity cap', scopeBucketId: null, params: { subject: 'tag', tagId: equity.id, maxPercent: '80' } }, NOW);
    expect(() => deleteTag(db, equity.id)).toThrow(/Equity cap/);
  });
});

describe('rules', () => {
  let db: TestDb;
  let equityId: string;
  let fixedId: string;
  beforeEach(() => {
    db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
    const tags = listTags(db, NOW);
    equityId = tags.find((t) => t.name === 'Equity')!.id;
    fixedId = tags.find((t) => t.name === 'Fixed income')!.id;
  });

  it('creates each kind of rule with validated params', () => {
    createRule(db, { kind: 'concentration', name: 'Max 20% per holding', scopeBucketId: null, params: { subject: 'security', maxPercent: '20' } }, NOW);
    createRule(
      db,
      {
        kind: 'allocation',
        name: '60/40',
        scopeBucketId: null,
        params: { targets: [{ tagId: equityId, percent: '60' }, { tagId: fixedId, percent: '40' }], tolerance: '5' },
      },
      NOW,
    );
    createRule(db, { kind: 'cash_floor', name: 'Keep 5% cash', scopeBucketId: null, params: { minPercent: '5' } }, NOW);
    createRule(db, { kind: 'currency_exposure', name: 'USD ≤ 40%', scopeBucketId: null, params: { currency: 'USD', maxPercent: '40' } }, NOW);
    expect(listRules(db).map((r) => r.kind)).toEqual(['concentration', 'allocation', 'cash_floor', 'currency_exposure']);
    expect(listRules(db)[1]!.params).toEqual({ targets: [{ tagId: equityId, percent: '60' }, { tagId: fixedId, percent: '40' }], tolerance: '5' });
  });

  it('rejects bad params with readable messages', () => {
    const make = (kind: 'concentration' | 'allocation' | 'cash_floor' | 'currency_exposure', params: unknown, name = 'R') =>
      createRule(db, { kind, name, scopeBucketId: null, params }, NOW);
    expect(() => make('concentration', { subject: 'security', maxPercent: '120' })).toThrow(/between/);
    expect(() => make('concentration', { subject: 'security', maxPercent: '20%' })).toThrow(/number like/);
    expect(() => make('concentration', { subject: 'tag', maxPercent: '20' })).toThrow(/tag/);
    expect(() => make('allocation', { targets: [], tolerance: '5' })).toThrow(/at least one/);
    expect(() => make('allocation', { targets: [{ tagId: equityId, percent: '70' }, { tagId: fixedId, percent: '40' }], tolerance: '5' })).toThrow(/110%/);
    expect(() => make('allocation', { targets: [{ tagId: 'gone', percent: '50' }], tolerance: '5' })).toThrow(/no longer exists/);
    expect(() => make('currency_exposure', { currency: 'usd', maxPercent: '40' })).toThrow(ValidationError);
    expect(() => make('cash_floor', { minPercent: '5' }, '  ')).toThrow(/name/);
    expect(listRules(db)).toEqual([]);
  });

  it('scopes rules to a bucket, and updates, disables and deletes them', () => {
    const bucket = createBucket(db, { name: 'Retirement', parentId: null }, NOW);
    const rule = createRule(db, { kind: 'cash_floor', name: 'Cash', scopeBucketId: bucket.id, params: { minPercent: '5' } }, NOW);
    expect(rule.scopeBucketId).toBe(bucket.id);
    updateRule(db, rule.id, { kind: 'cash_floor', name: 'Cash 10%', scopeBucketId: null, params: { minPercent: '10' } }, NOW);
    setRuleEnabled(db, rule.id, false, NOW);
    expect(listRules(db)[0]).toMatchObject({ name: 'Cash 10%', scopeBucketId: null, enabled: false, params: { minPercent: '10' } });
    deleteRule(db, rule.id);
    expect(listRules(db)).toEqual([]);
  });
});

describe('warning responses', () => {
  it('snoozes until a date, acknowledges for 30 days, and can show a warning again', () => {
    const db = openTestDb();
    migrate(db, 'user', USER_MIGRATIONS);
    respondToWarning(db, { warningKey: 'k1', response: 'snoozed', snoozeUntil: '2026-12-01', today: '2026-11-02' }, NOW);
    respondToWarning(db, { warningKey: 'k2', response: 'acknowledged', note: 'Fine for now', today: '2026-11-02' }, NOW);
    expect(() => respondToWarning(db, { warningKey: 'k3', response: 'snoozed', snoozeUntil: '2026-11-01', today: '2026-11-02' }, NOW)).toThrow(/future/);
    const latest = () => new Map(latestWarningResponses(db).map((r) => [r.warningKey, r]));
    expect(latest().get('k1')!.hiddenUntil).toBe('2026-12-01');
    expect(latest().get('k2')).toMatchObject({ response: 'acknowledged', note: 'Fine for now', hiddenUntil: '2026-12-02' });
    unhideWarning(db, 'k1', '2026-11-02', NOW + 1);
    expect(latest().get('k1')!.hiddenUntil).toBe('2026-11-01');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
