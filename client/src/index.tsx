/**
 * React application entry point with providers and router setup.
 */
import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import UserContextProvider from './providers/UserContextProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { initializeErrorTracking } from './utils/errorTracking';

initializeErrorTracking();

const AgentationToolbar = import.meta.env.DEV
  ? React.lazy(async () => {
      const { Agentation } = await import('agentation');
      return { default: Agentation };
    })
  : null;

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container missing in index.html');
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <UserContextProvider>
        <App />
        {AgentationToolbar ? (
          <Suspense fallback={null}>
            <AgentationToolbar />
          </Suspense>
        ) : null}
      </UserContextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

reportWebVitals();
