import { useState, type FormEvent } from 'react';
import { db, errorMessage } from '../../db/client';
import type { Tag } from '../../db/rulesRepo';
import { href } from '../router';
import { useAsync } from '../useAsync';

function TagRow({ tag, onChanged }: { tag: Tag; onChanged: (error?: string) => void }) {
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      onChanged();
    } catch (e) {
      onChanged(errorMessage(e));
    }
  };
  return (
    <li className="tag-row">
      <label className="field">
        <span className="visually-hidden">Tag name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Tag ${tag.name}`} />
      </label>
      <div className="button-row">
        <button type="button" className="secondary" disabled={name.trim() === tag.name} onClick={() => void run(() => db('renameTag', tag.id, name))}>
          Rename
        </button>
        {confirming ? (
          <>
            <button type="button" className="danger" onClick={() => void run(() => db('deleteTag', tag.id))}>
              Confirm delete
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="secondary" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export function TagsScreen() {
  const [state, reload] = useAsync(() => db('listTags'), []);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const submitted = name;
    try {
      await db('createTag', submitted);
      setName((current) => (current === submitted ? '' : current));
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
      <h1>Tags</h1>
      <p className="muted small">
        Tags classify holdings (e.g. Equity, Canada, AI theme). Allocation and tag rules use them. Tag a holding on its
        screen.
      </p>
      <form className="card form" onSubmit={(event) => void add(event)} noValidate>
        <div className="field-row">
          <label className="field">
            New tag
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dividend" />
          </label>
          <div className="button-row align-end">
            <button type="submit">Add tag</button>
          </div>
        </div>
      </form>
      {error && (
        <p className="result fail small" role="alert">
          {error}
        </p>
      )}
      {state.status === 'ready' && (
        <ul className="plain card">
          {state.data.map((tag) => (
            <TagRow
              key={`${tag.id}:${tag.name}`}
              tag={tag}
              onChanged={(problem) => {
                setError(problem ?? null);
                reload();
              }}
            />
          ))}
          {state.data.length === 0 && <li className="muted small">No tags.</li>}
        </ul>
      )}
    </section>
  );
}
