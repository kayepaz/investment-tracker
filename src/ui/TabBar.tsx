import type { ReactNode } from 'react';
import { href, type Route } from './router';

type Tab = { route: Route; label: string; matches: Route['name'][]; icon: ReactNode };

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const TABS: Tab[] = [
  {
    route: { name: 'buckets' },
    label: 'Buckets',
    matches: ['buckets', 'buckets-manage', 'holding'],
    icon: (
      <svg {...iconProps}>
        <path d="M3 6h18" />
        <path d="M7 12h14" />
        <path d="M11 18h10" />
      </svg>
    ),
  },
  {
    route: { name: 'accounts' },
    label: 'Accounts',
    matches: ['accounts', 'account', 'account-new', 'transaction-new'],
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
      </svg>
    ),
  },
  {
    route: { name: 'strategies' },
    label: 'Strategies',
    matches: ['strategies'],
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </svg>
    ),
  },
  {
    route: { name: 'journal' },
    label: 'Journal',
    matches: ['journal'],
    icon: (
      <svg {...iconProps}>
        <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
        <path d="M9 9h6" />
        <path d="M9 13h6" />
      </svg>
    ),
  },
  {
    route: { name: 'settings' },
    label: 'Settings',
    matches: ['settings'],
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
      </svg>
    ),
  },
];

export function TabBar({ current }: { current: Route }) {
  return (
    <nav className="tab-bar" aria-label="Sections">
      {TABS.map((tab) => {
        const active = tab.matches.includes(current.name);
        return (
          <a key={tab.label} href={href(tab.route)} className={active ? 'tab active' : 'tab'} aria-current={active ? 'page' : undefined}>
            {tab.icon}
            <span>{tab.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
