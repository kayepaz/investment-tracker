import type { BucketNode } from '../../portfolio/tree';
import type { Warning } from '../../rules/evaluate';
import { loadPortfolio } from '../portfolioData';
import { href } from '../router';
import { useAsync } from '../useAsync';
import { WarningCard } from '../WarningCard';

type Place = { path: string; order: number };

/** Each holding and bucket's place in the tree, e.g. "Retirement › TFSA", in tree order. */
function places(roots: BucketNode[]) {
  const buckets = new Map<string, Place>();
  const holdings = new Map<string, Place & { label: string; accountId: string; securityId: string }>();
  let order = 0;
  const walk = (nodes: BucketNode[], prefix: string) => {
    for (const node of nodes) {
      const path = prefix ? `${prefix} › ${node.bucket.name}` : node.bucket.name;
      buckets.set(node.bucket.id, { path, order: order++ });
      for (const h of node.holdings) {
        holdings.set(h.key, { path, order: order++, label: `${h.label} · ${h.accountName}`, accountId: h.accountId, securityId: h.securityId });
      }
      walk(node.children, path);
    }
  };
  walk(roots, '');
  return { buckets, holdings };
}

export function WarningsScreen() {
  const [state, reload] = useAsync(loadPortfolio, []);
  if (state.status === 'loading') return <p className="muted">Loading…</p>;
  if (state.status === 'error') return <p className="result fail">{state.message}</p>;

  const { tree, evaluation } = state.data;
  const where = places(tree.roots);

  // Group visible warnings by where they appear in the tree.
  const groups = new Map<string, { order: number; items: { warning: Warning; context?: string; link?: string }[] }>();
  const addTo = (path: string, order: number, item: { warning: Warning; context?: string; link?: string }) => {
    const group = groups.get(path) ?? { order, items: [] };
    group.items.push(item);
    groups.set(path, group);
  };
  for (const warning of evaluation.warnings.filter((w) => !w.hiddenBy)) {
    const t = warning.target;
    if (t.kind === 'portfolio') addTo('Whole portfolio', -1, { warning });
    else if (t.kind === 'bucket') {
      const place = where.buckets.get(t.bucketId);
      if (place) addTo(place.path, place.order, { warning });
    } else {
      // Shown once, under the first holding's bucket, listing every holding involved.
      const holdingPlaces = t.holdingKeys.map((k) => where.holdings.get(k)).filter((p) => p !== undefined);
      const first = holdingPlaces.sort((a, b) => a.order - b.order)[0];
      if (first) {
        addTo(first.path, first.order, {
          warning,
          context: holdingPlaces.map((p) => `${p.label} (${p.path})`).join(', '),
          link: href({ name: 'holding', accountId: first.accountId, securityId: first.securityId }),
        });
      }
    }
  }
  const sorted = [...groups.entries()].sort((a, b) => a[1].order - b[1].order);
  const hidden = evaluation.warnings.filter((w) => w.hiddenBy);

  return (
    <section>
      <div className="screen-header">
        <h1>Needs attention</h1>
        <a className="button-link secondary" href={href({ name: 'buckets' })}>
          Back to buckets
        </a>
      </div>

      {sorted.length === 0 && (
        <div className="card">
          <p>No warnings right now.</p>
          <p className="muted small">
            {state.data.rules.length === 0 ? (
              <>
                You haven’t set any rules yet. <a href={href({ name: 'rules' })}>Add a rule</a>.
              </>
            ) : (
              'Everything is within your rules.'
            )}
          </p>
        </div>
      )}

      {sorted.map(([path, group]) => (
        <div key={path} className="warning-group">
          <h2>{path}</h2>
          {group.items.map(({ warning, context, link }) => (
            <div key={warning.key}>
              <WarningCard warning={warning} context={context} onChanged={reload} />
              {link && (
                <p className="small">
                  <a href={link}>Open holding</a>
                </p>
              )}
            </div>
          ))}
        </div>
      ))}

      {hidden.length > 0 && (
        <details className="card">
          <summary>
            {hidden.length} snoozed or acknowledged
          </summary>
          {hidden.map((warning) => (
            <WarningCard key={warning.key} warning={warning} onChanged={reload} />
          ))}
        </details>
      )}
    </section>
  );
}
