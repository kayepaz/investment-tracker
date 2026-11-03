import { href } from '../router';

export function BucketsScreen() {
  return (
    <section>
      <h1>Buckets</h1>
      <p className="muted">
        The bucket tree arrives in the next step. Start by adding your accounts and their transactions, so there is
        something to group.
      </p>
      <p>
        <a className="button-link" href={href({ name: 'accounts' })}>
          Go to Accounts
        </a>
      </p>
    </section>
  );
}

export function ComingLater({ title }: { title: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">Coming in a later milestone.</p>
    </section>
  );
}
