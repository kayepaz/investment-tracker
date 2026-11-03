import { useState, type FormEvent } from 'react';
import type { Bucket } from '../../db/bucketsRepo';
import { db, errorMessage } from '../../db/client';
import { flattenBuckets } from '../../portfolio/tree';
import { href } from '../router';
import { useAsync } from '../useAsync';

const TOP = '';

function parentChoices(buckets: Bucket[], excluding?: Bucket) {
  // A bucket can't go inside itself or its own descendants, or inside Unassigned.
  const blocked = new Set<string>();
  if (excluding) {
    blocked.add(excluding.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of buckets) {
        if (b.parentId && blocked.has(b.parentId) && !blocked.has(b.id)) {
          blocked.add(b.id);
          grew = true;
        }
      }
    }
  }
  return flattenBuckets(buckets).filter(({ bucket }) => !bucket.isUnassigned && !blocked.has(bucket.id));
}

function BucketEditor({ bucket, depth, buckets, onChanged }: { bucket: Bucket; depth: number; buckets: Bucket[]; onChanged: (error?: string) => void }) {
  const [name, setName] = useState(bucket.name);
  const [confirming, setConfirming] = useState(false);

  async function run(work: () => Promise<unknown>) {
    try {
      await work();
      onChanged();
    } catch (e) {
      onChanged(errorMessage(e));
    }
  }

  if (bucket.isUnassigned) {
    return (
      <li className="bucket-edit" style={{ paddingLeft: depth * 20 }}>
        <span className="tree-name unassigned">Unassigned</span>
        <span className="hint">Built in: new holdings start here.</span>
      </li>
    );
  }

  return (
    <li className="bucket-edit" style={{ paddingLeft: depth * 20 }}>
      <div className="field-row">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Inside
          <select value={bucket.parentId ?? TOP} onChange={(e) => void run(() => db('moveBucket', bucket.id, e.target.value || null))}>
            <option value={TOP}>Top level</option>
            {parentChoices(buckets, bucket).map(({ bucket: b, depth: d }) => (
              <option key={b.id} value={b.id}>
                {'  '.repeat(d)}
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="button-row">
        <button type="button" className="secondary" disabled={name.trim() === bucket.name} onClick={() => void run(() => db('renameBucket', bucket.id, name))}>
          Rename
        </button>
        {!confirming ? (
          <button type="button" className="secondary" onClick={() => setConfirming(true)}>
            Delete
          </button>
        ) : (
          <>
            <button type="button" className="danger" onClick={() => void run(() => db('deleteBucket', bucket.id))}>
              Confirm delete
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function ManageBucketsScreen() {
  const [state, reload] = useAsync(() => db('listBuckets'), []);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(TOP);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="result fail">{state.message}</p>;
  const buckets = state.data;

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await db('createBucket', { name, parentId: parentId || null });
      setName('');
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const changed = (problem?: string) => {
    setError(problem ?? null);
    reload();
  };

  return (
    <section>
      <p>
        <a href={href({ name: 'buckets' })}>‹ Buckets</a>
      </p>
      <h1>Manage buckets</h1>

      <form className="card form" onSubmit={(event) => void add(event)} noValidate>
        <h2>New bucket</h2>
        <div className="field-row">
          <label className="field">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retirement" />
          </label>
          <label className="field">
            Inside
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value={TOP}>Top level</option>
              {parentChoices(buckets).map(({ bucket, depth }) => (
                <option key={bucket.id} value={bucket.id}>
                  {'  '.repeat(depth)}
                  {bucket.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="button-row">
          <button type="submit">Add bucket</button>
        </div>
      </form>

      {error && (
        <p className="result fail small" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <h2>Your buckets</h2>
        <ul className="plain">
          {flattenBuckets(buckets).map(({ bucket, depth }) => (
            <BucketEditor key={`${bucket.id}:${bucket.name}:${bucket.parentId}`} bucket={bucket} depth={depth} buckets={buckets} onChanged={changed} />
          ))}
        </ul>
        <p className="hint">Only buckets without sub-buckets hold investments. To delete a bucket, empty it first.</p>
      </div>
    </section>
  );
}
