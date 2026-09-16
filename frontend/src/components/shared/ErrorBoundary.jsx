import { Component } from 'react';
import * as Sentry from '@sentry/react';
import { Btn } from './UI';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    // A no-op if Sentry was never initialized (no VITE_SENTRY_DSN) — React
    // render errors don't reach window.onerror on their own, so without
    // this an error boundary catching one would otherwise never get
    // reported.
    Sentry.captureException(error, { extra: errorInfo });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-deck flex items-center justify-center p-6">
          <div className="panel p-8 max-w-md text-center animate-fade-in">
            <div className="w-14 h-14 rounded-full bg-alert/15 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-alert" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-display font-bold text-ink mb-2">Something went wrong</h2>
            <p className="text-sm text-annotation mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex gap-3 justify-center">
              <Btn variant="primary" onClick={() => window.location.reload()}>
                Reload Page
              </Btn>
              <Btn variant="ghost" onClick={() => window.history.back()}>
                Go Back
              </Btn>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
