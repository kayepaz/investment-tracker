import { useEffect, useState } from 'react';
import { openDatabases, requestPersistentStorage } from './db/client';
import type { DbStatus } from './db/protocol';
import { useRoute } from './ui/router';
import { AccountScreen } from './ui/screens/AccountScreen';
import { AccountsScreen } from './ui/screens/AccountsScreen';
import { AddTransactionScreen } from './ui/screens/AddTransactionScreen';
import { NewAccountScreen } from './ui/screens/NewAccountScreen';
import { BucketsScreen } from './ui/screens/BucketsScreen';
import { HoldingScreen } from './ui/screens/HoldingScreen';
import { ManageBucketsScreen } from './ui/screens/ManageBucketsScreen';
import { ComingLater } from './ui/screens/Placeholders';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { TabBar } from './ui/TabBar';

export function App() {
  const route = useRoute();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void openDatabases().then(setStatus);
    void requestPersistentStorage().then(setPersisted);
  }, []);

  let content;
  if (status === null) {
    content = <p className="muted">Opening your data…</p>;
  } else if (!status.ok && route.name !== 'settings') {
    content = (
      <div className="result fail" role="alert">
        <p>Your data couldn’t be opened while trying to {status.stage}.</p>
        <p className="small">{status.error}</p>
        <p className="small">If the app is open in another tab or window, close it and reload this page.</p>
      </div>
    );
  } else {
    switch (route.name) {
      case 'buckets':
        content = <BucketsScreen />;
        break;
      case 'buckets-manage':
        content = <ManageBucketsScreen />;
        break;
      case 'holding':
        content = <HoldingScreen key={`${route.accountId}|${route.securityId}`} accountId={route.accountId} securityId={route.securityId} />;
        break;
      case 'accounts':
        content = <AccountsScreen />;
        break;
      case 'account-new':
        content = <NewAccountScreen />;
        break;
      case 'account':
        content = <AccountScreen key={route.id} id={route.id} />;
        break;
      case 'transaction-new':
        content = <AddTransactionScreen key={route.accountId} accountId={route.accountId} />;
        break;
      case 'strategies':
        content = <ComingLater title="Strategies" />;
        break;
      case 'journal':
        content = <ComingLater title="Journal" />;
        break;
      case 'settings':
        content = <SettingsScreen status={status} persisted={persisted} />;
        break;
    }
  }

  return (
    <>
      <main className="app">
        <p className="dev-banner small">Early development build. Data entered now may need to be re-entered later.</p>
        {content}
      </main>
      <TabBar current={route} />
    </>
  );
}
