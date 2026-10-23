import { EXPECTED_MODULE_COUNT } from '@csense/shared';

/** Phase 0 empty shell. The security gate and screens arrive in Phases 5-7. */
export function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        margin: 0,
        background: '#0b0f17',
        color: '#e6edf3',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>CSense</h1>
        <p style={{ opacity: 0.7 }}>
          Security awareness training · {EXPECTED_MODULE_COUNT} modules
        </p>
      </div>
    </main>
  );
}
