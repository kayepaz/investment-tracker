import { useState } from 'react';
import type { Bucket } from '../../db/bucketsRepo';
import { db, errorMessage } from '../../db/client';
import type { Tag } from '../../db/rulesRepo';
import { RULE_KIND_LABELS, type AllocationParams, type CashFloorParams, type ConcentrationParams, type CurrencyExposureParams, type Rule } from '../../rules/types';
import { href } from '../router';
import { useAsync } from '../useAsync';

async function loadRules() {
  const [rules, buckets, tags] = await Promise.all([db('listRules'), db('listBuckets'), db('listTags')]);
  return { rules, buckets, tags };
}

/** A one-line description of what a rule checks. */
export function describeRule(rule: Pick<Rule, 'kind' | 'params'>, tags: Tag[]): string {
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? 'a deleted tag';
  switch (rule.kind) {
    case 'concentration': {
      const p = rule.params as ConcentrationParams;
      return p.subject === 'security' ? `No single holding over ${p.maxPercent}%` : `${tagName(p.tagId)} no more than ${p.maxPercent}%`;
    }
    case 'allocation': {
      const p = rule.params as AllocationParams;
      return `${p.targets.map((t) => `${tagName(t.tagId)} ${t.percent}%`).join(', ')}, ± ${p.tolerance} points`;
    }
    case 'cash_floor':
      return `At least ${(rule.params as CashFloorParams).minPercent}% in cash`;
    case 'currency_exposure': {
      const p = rule.params as CurrencyExposureParams;
      return `${p.currency} holdings no more than ${p.maxPercent}%`;
    }
  }
}

export function scopeName(scopeBucketId: string | null, buckets: Bucket[]): string {
  if (scopeBucketId === null) return 'Whole portfolio';
  return buckets.find((b) => b.id === scopeBucketId)?.name ?? 'A deleted bucket';
}

export function RulesScreen() {
  const [state, reload] = useAsync(loadRules, []);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      setConfirming(null);
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section>
      <p>
        <a href={href({ name: 'settings' })}>‹ Settings</a>
      </p>
      <div className="screen-header">
        <h1>Rules</h1>
        <a className="button-link" href={href({ name: 'rule-new' })}>
          + New rule
        </a>
      </div>
      <p className="muted small">Rules are limits you set. When one is broken, a warning badge appears on the bucket tree.</p>
      {error && (
        <p className="result fail small" role="alert">
          {error}
        </p>
      )}
      {state.status === 'loading' && <p className="muted">Loading…</p>}
      {state.status === 'error' && <p className="result fail">{state.message}</p>}
      {state.status === 'ready' && state.data.rules.length === 0 && (
        <div className="card">
          <p>No rules yet.</p>
          <p className="muted small">For example: no single holding over 20% of the portfolio, or keep at least 5% in cash.</p>
        </div>
      )}
      {state.status === 'ready' && state.data.rules.length > 0 && (
        <ul className="list">
          {state.data.rules.map((rule) => (
            <li key={rule.id} className="rule-row">
              <div className="list-main">
                <a className="list-title" href={href({ name: 'rule', id: rule.id })}>
                  {rule.name}
                </a>
                <span className="small muted">
                  {RULE_KIND_LABELS[rule.kind]} · {scopeName(rule.scopeBucketId, state.data.buckets)}
                </span>
                <span className="small">{describeRule(rule, state.data.tags)}</span>
              </div>
              <div className="list-side">
                <label className="toggle small">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => void run(() => db('setRuleEnabled', rule.id, e.target.checked))} />
                  On
                </label>
                {confirming === rule.id ? (
                  <span className="confirm small">
                    <button type="button" className="link-button danger" onClick={() => void run(() => db('deleteRule', rule.id))}>
                      Confirm
                    </button>
                    <button type="button" className="link-button" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="link-button small" onClick={() => setConfirming(rule.id)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
