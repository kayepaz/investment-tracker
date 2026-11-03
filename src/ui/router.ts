import { useEffect, useState } from 'react';

// A tiny hash-based router: URLs look like #/accounts/<id>. Hash routing works on any static
// host (GitHub Pages) and when the app is installed, with no server configuration.

export type Route =
  | { name: 'buckets' }
  | { name: 'buckets-manage' }
  | { name: 'holding'; accountId: string; securityId: string }
  | { name: 'accounts' }
  | { name: 'account-new' }
  | { name: 'account'; id: string }
  | { name: 'transaction-new'; accountId: string }
  | { name: 'strategies' }
  | { name: 'journal' }
  | { name: 'settings' }
  | { name: 'rules' }
  | { name: 'rule-new' }
  | { name: 'rule'; id: string }
  | { name: 'tags' }
  | { name: 'warnings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  switch (first) {
    case 'buckets':
      if (second === 'manage') return { name: 'buckets-manage' };
      return { name: 'buckets' };
    case 'holding':
      if (second && third) return { name: 'holding', accountId: second, securityId: third };
      return { name: 'buckets' };
    case 'accounts':
      if (second === 'new') return { name: 'account-new' };
      if (second && third === 'add') return { name: 'transaction-new', accountId: second };
      if (second) return { name: 'account', id: second };
      return { name: 'accounts' };
    case 'strategies':
      return { name: 'strategies' };
    case 'journal':
      return { name: 'journal' };
    case 'settings':
      return { name: 'settings' };
    case 'rules':
      if (second === 'new') return { name: 'rule-new' };
      if (second) return { name: 'rule', id: second };
      return { name: 'rules' };
    case 'tags':
      return { name: 'tags' };
    case 'warnings':
      return { name: 'warnings' };
    default:
      return { name: 'buckets' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'buckets':
      return '#/';
    case 'buckets-manage':
      return '#/buckets/manage';
    case 'holding':
      return `#/holding/${encodeURIComponent(route.accountId)}/${encodeURIComponent(route.securityId)}`;
    case 'accounts':
      return '#/accounts';
    case 'account-new':
      return '#/accounts/new';
    case 'account':
      return `#/accounts/${encodeURIComponent(route.id)}`;
    case 'transaction-new':
      return `#/accounts/${encodeURIComponent(route.accountId)}/add`;
    case 'rule-new':
      return '#/rules/new';
    case 'rule':
      return `#/rules/${encodeURIComponent(route.id)}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
