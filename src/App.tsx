import { StoreProvider } from './lib/store';
import { href, useRoute } from './router';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DrillPage } from './features/drill/DrillPage';
import { SimulatorPage } from './features/simulator/SimulatorPage';
import { ExportPage } from './features/export/ExportPage';
import { EXAM_DATE } from './types';

const NAV: { path: string; label: string }[] = [
  { path: '/', label: 'Readiness' },
  { path: '/drill', label: 'Drill' },
  { path: '/simulator', label: 'Simulator' },
  { path: '/export', label: 'Export' },
];

const daysToExam = (): number =>
  Math.max(0, Math.ceil((EXAM_DATE.getTime() - Date.now()) / 86_400_000));

function Chrome({ children, path }: { children: React.ReactNode; path: string }) {
  const days = daysToExam();
  return (
    <div className="app">
      <nav className="topbar">
        <span className="brand">PL-400</span>
        {NAV.map((n) => (
          <a
            key={n.path}
            className="navlink"
            href={href(n.path)}
            aria-current={path === n.path ? 'page' : undefined}
          >
            {n.label}
          </a>
        ))}
        <span className="spacer" />
        <span className="tiny faint num" title="Exam: Thursday 17 September 2026">
          {days} days
        </span>
      </nav>
      {children}
    </div>
  );
}

export function App() {
  const route = useRoute();

  const page = (() => {
    switch (route.path) {
      case '/drill':
        return <DrillPage params={route.params} />;
      case '/simulator':
        return <SimulatorPage params={route.params} />;
      case '/export':
        return <ExportPage params={route.params} />;
      case '/':
        return <DashboardPage params={route.params} />;
      default:
        return (
          <main className="page page-narrow">
            <div className="card">
              <h1>Not found</h1>
              <p className="muted">
                No route for <code>{route.path}</code>. <a href={href('/')}>Back to readiness</a>.
              </p>
            </div>
          </main>
        );
    }
  })();

  return (
    <StoreProvider>
      <Chrome path={route.path}>{page}</Chrome>
    </StoreProvider>
  );
}
