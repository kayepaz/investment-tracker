import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from './router';

describe('router', () => {
  it('parses known routes', () => {
    expect(parseRoute('')).toEqual({ name: 'buckets' });
    expect(parseRoute('#/')).toEqual({ name: 'buckets' });
    expect(parseRoute('#/accounts')).toEqual({ name: 'accounts' });
    expect(parseRoute('#/accounts/new')).toEqual({ name: 'account-new' });
    expect(parseRoute('#/accounts/abc')).toEqual({ name: 'account', id: 'abc' });
    expect(parseRoute('#/accounts/abc/add')).toEqual({ name: 'transaction-new', accountId: 'abc' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/nonsense')).toEqual({ name: 'buckets' });
  });

  it('round-trips every route through its URL', () => {
    const routes: Route[] = [
      { name: 'buckets' },
      { name: 'accounts' },
      { name: 'account-new' },
      { name: 'account', id: '018bcfe5-6800-7000-8000-000000000000' },
      { name: 'transaction-new', accountId: 'x' },
      { name: 'strategies' },
      { name: 'journal' },
      { name: 'settings' },
    ];
    for (const route of routes) {
      expect(parseRoute(href(route))).toEqual(route);
    }
  });
});
