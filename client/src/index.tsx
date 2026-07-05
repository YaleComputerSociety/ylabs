/**
 * React application entry point with providers and router setup.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import UserContextProvider from './providers/UserContextProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { initializeErrorTracking } from './utils/errorTracking';

initializeErrorTracking();

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
      </UserContextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

reportWebVitals();
