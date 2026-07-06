import React from 'react';
import { captureClientError } from '../utils/errorTracking';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    captureClientError(error, errorInfo.componentStack ?? undefined);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleHome = () => {
    window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
          <section
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm"
            role="alert"
            aria-labelledby="error-boundary-title"
          >
            <h1 id="error-boundary-title" className="text-2xl font-semibold text-slate-900">
              Something went wrong
            </h1>
            <p className="mt-4 text-slate-600">
              The page hit an unexpected error. Refresh to try again, or return home.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                className="rounded-md bg-blue-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
                onClick={this.handleReload}
              >
                Refresh page
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={this.handleHome}
              >
                Go home
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
