import { useState } from 'react';
import { db, errorMessage } from '../db/client';
import { ACKNOWLEDGE_DAYS, addDays } from '../db/rulesRepo';
import type { Warning } from '../rules/evaluate';
import { formatDate, today } from './format';

const SNOOZES = [
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 91 },
];

/** One warning, with snooze and acknowledge (or "show again" when hidden). */
export function WarningCard({ warning, onChanged, context }: { warning: Warning; onChanged: () => void; context?: string }) {
  const [mode, setMode] = useState<'idle' | 'snooze' | 'acknowledge'>('idle');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      setMode('idle');
      setNote('');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const now = today();
  const hidden = warning.hiddenBy;

  return (
    <div className={`warning-card${hidden ? ' hidden-warning' : ''}`}>
      <p className="warning-message">
        <strong>{warning.message}</strong>
      </p>
      <p className="muted small">
        Rule: {warning.rule.name}
        {context ? ` · ${context}` : ''}
        {warning.incomplete ? ' · some holdings in scope have no price yet, so this may change' : ''}
      </p>
      {hidden && (
        <p className="muted small">
          {hidden.response === 'acknowledged' ? 'Acknowledged' : 'Snoozed'} until {formatDate(hidden.hiddenUntil!)}
          {hidden.note ? `: “${hidden.note}”` : ''}
        </p>
      )}

      {hidden ? (
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => void run(() => db('unhideWarning', warning.key, now))}>
            Show again
          </button>
        </div>
      ) : mode === 'idle' ? (
        <div className="button-row">
          <button type="button" onClick={() => setMode('acknowledge')}>
            Acknowledge
          </button>
          <button type="button" className="secondary" onClick={() => setMode('snooze')}>
            Snooze
          </button>
        </div>
      ) : mode === 'snooze' ? (
        <div className="button-row">
          {SNOOZES.map((s) => (
            <button
              key={s.days}
              type="button"
              className="secondary"
              onClick={() => void run(() => db('respondToWarning', { warningKey: warning.key, response: 'snoozed', snoozeUntil: addDays(now, s.days), today: now }))}
            >
              {s.label}
            </button>
          ))}
          <button type="button" className="link-button" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="form">
          <label className="field">
            Note <span className="muted">(optional; kept for your journal)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fine for now; rebalancing in January" />
          </label>
          <div className="button-row">
            <button
              type="button"
              onClick={() => void run(() => db('respondToWarning', { warningKey: warning.key, response: 'acknowledged', note, today: now }))}
            >
              Acknowledge for {ACKNOWLEDGE_DAYS} days
            </button>
            <button type="button" className="link-button" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="result fail small">{error}</p>}
    </div>
  );
}
