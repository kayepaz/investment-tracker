import { APP_NAME } from './appInfo';
import { SpikePanel } from './spike/SpikePanel';

export function App() {
  return (
    <main className="app">
      <header className="app-header">
        <h1>{APP_NAME}</h1>
        <p className="tagline">Track your investments against the plan you made for them.</p>
      </header>
      <section className="status" aria-label="Project status">
        <p>
          This is an early development build. Nothing here stores financial data yet, so please don't enter real
          financial information.
        </p>
      </section>
      <SpikePanel />
    </main>
  );
}
