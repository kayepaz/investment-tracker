import { useState, type FormEvent } from 'react';
import type { Bucket } from '../../db/bucketsRepo';
import { db, errorMessage } from '../../db/client';
import type { Tag } from '../../db/rulesRepo';
import { flattenBuckets } from '../../portfolio/tree';
import {
  RULE_KIND_LABELS,
  type AllocationParams,
  type CashFloorParams,
  type ConcentrationParams,
  type CurrencyExposureParams,
  type Rule,
  type RuleKind,
} from '../../rules/types';
import { CURRENCIES } from '../currencies';
import { href, navigate } from '../router';
import { useAsync } from '../useAsync';
import { describeRule } from './RulesScreen';

async function loadForm(id: string | null) {
  const [rules, buckets, tags] = await Promise.all([db('listRules'), db('listBuckets'), db('listTags')]);
  return { rule: id ? (rules.find((r) => r.id === id) ?? null) : null, buckets, tags };
}

export function RuleFormScreen({ id }: { id: string | null }) {
  const [state] = useAsync(() => loadForm(id), [id]);
  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="result fail">{state.message}</p>;
  if (id && !state.data.rule) return <p>That rule no longer exists.</p>;
  return <RuleForm rule={state.data.rule} buckets={state.data.buckets} tags={state.data.tags} />;
}

const TOP = '';

function RuleForm({ rule, buckets, tags }: { rule: Rule | null; buckets: Bucket[]; tags: Tag[] }) {
  const firstTag = tags[0]?.id ?? '';
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? 'concentration');
  const [name, setName] = useState(rule?.name ?? '');
  const [scope, setScope] = useState(rule?.scopeBucketId ?? TOP);

  const c = rule?.kind === 'concentration' ? (rule.params as ConcentrationParams) : null;
  const [concSubject, setConcSubject] = useState<'security' | 'tag'>(c?.subject ?? 'security');
  const [concTag, setConcTag] = useState(c?.subject === 'tag' ? c.tagId : firstTag);
  const [concMax, setConcMax] = useState(c?.maxPercent ?? '20');

  const a = rule?.kind === 'allocation' ? (rule.params as AllocationParams) : null;
  const [targets, setTargets] = useState(a?.targets ?? [{ tagId: firstTag, percent: '' }]);
  const [tolerance, setTolerance] = useState(a?.tolerance ?? '5');

  const [cashMin, setCashMin] = useState(rule?.kind === 'cash_floor' ? (rule.params as CashFloorParams).minPercent : '5');
  const x = rule?.kind === 'currency_exposure' ? (rule.params as CurrencyExposureParams) : null;
  const [currency, setCurrency] = useState(x?.currency ?? 'USD');
  const [currencyMax, setCurrencyMax] = useState(x?.maxPercent ?? '40');

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const params = (): unknown => {
    switch (kind) {
      case 'concentration':
        return concSubject === 'security' ? { subject: 'security', maxPercent: concMax } : { subject: 'tag', tagId: concTag, maxPercent: concMax };
      case 'allocation':
        return { targets, tolerance };
      case 'cash_floor':
        return { minPercent: cashMin };
      case 'currency_exposure':
        return { currency, maxPercent: currencyMax };
    }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const p = params();
    // Default name: the rule's own description.
    let finalName = name.trim();
    if (!finalName) {
      try {
        finalName = describeRule({ kind, params: p as Rule['params'] }, tags);
      } catch {
        finalName = RULE_KIND_LABELS[kind];
      }
    }
    const input = { kind, name: finalName, scopeBucketId: scope || null, params: p };
    try {
      if (rule) await db('updateRule', rule.id, input);
      else await db('createRule', input);
      navigate({ name: 'rules' });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  const scopes = flattenBuckets(buckets).filter(({ bucket }) => !bucket.isUnassigned);
  const tagOptions = tags.map((t) => (
    <option key={t.id} value={t.id}>
      {t.name}
    </option>
  ));
  const noTags = tags.length === 0;

  return (
    <section>
      <p>
        <a href={href({ name: 'rules' })}>‹ Rules</a>
      </p>
      <h1>{rule ? 'Edit rule' : 'New rule'}</h1>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="field">
          Kind of rule
          <select value={kind} onChange={(e) => setKind(e.target.value as RuleKind)}>
            {(Object.keys(RULE_KIND_LABELS) as RuleKind[]).map((k) => (
              <option key={k} value={k}>
                {RULE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Applies to
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value={TOP}>Whole portfolio</option>
            {scopes.map(({ bucket, depth }) => (
              <option key={bucket.id} value={bucket.id}>
                {'  '.repeat(depth)}
                {bucket.name}
              </option>
            ))}
          </select>
          <span className="hint">A bucket includes everything inside it.</span>
        </label>

        {kind === 'concentration' && (
          <>
            <label className="field">
              Limit what
              <select value={concSubject} onChange={(e) => setConcSubject(e.target.value as 'security' | 'tag')}>
                <option value="security">Any single holding (across accounts)</option>
                <option value="tag">Everything with a tag</option>
              </select>
            </label>
            {concSubject === 'tag' && (
              <label className="field">
                Tag
                <select value={concTag} onChange={(e) => setConcTag(e.target.value)} disabled={noTags}>
                  {tagOptions}
                </select>
              </label>
            )}
            <label className="field">
              Maximum share (%)
              <input inputMode="decimal" value={concMax} onChange={(e) => setConcMax(e.target.value)} />
            </label>
          </>
        )}

        {kind === 'allocation' && (
          <fieldset className="subform">
            <legend>Targets by tag</legend>
            {targets.map((t, i) => (
              <div key={i} className="field-row">
                <label className="field">
                  Tag
                  <select
                    value={t.tagId}
                    onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, tagId: e.target.value } : x)))}
                    disabled={noTags}
                  >
                    {tagOptions}
                  </select>
                </label>
                <label className="field">
                  Target (%)
                  <input
                    inputMode="decimal"
                    value={t.percent}
                    onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                  />
                </label>
                {targets.length > 1 && (
                  <div className="button-row align-end">
                    <button type="button" className="link-button" onClick={() => setTargets(targets.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setTargets([...targets, { tagId: firstTag, percent: '' }])}>
                + Add target
              </button>
            </div>
            <label className="field">
              Tolerance (± percentage points)
              <input inputMode="decimal" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            </label>
          </fieldset>
        )}

        {kind === 'cash_floor' && (
          <label className="field">
            Minimum cash (%)
            <input inputMode="decimal" value={cashMin} onChange={(e) => setCashMin(e.target.value)} />
          </label>
        )}

        {kind === 'currency_exposure' && (
          <div className="field-row">
            <label className="field">
              Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Maximum share (%)
              <input inputMode="decimal" value={currencyMax} onChange={(e) => setCurrencyMax(e.target.value)} />
            </label>
          </div>
        )}

        {(kind === 'allocation' || (kind === 'concentration' && concSubject === 'tag')) && (
          <p className="hint">
            Tag your holdings on each holding’s screen. <a href={href({ name: 'tags' })}>Manage tags</a>
          </p>
        )}

        <label className="field">
          Name <span className="muted">(optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank to describe it automatically" />
        </label>

        {error && (
          <p className="result fail" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save rule'}
          </button>
          <a className="button-link secondary" href={href({ name: 'rules' })}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
