'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface TabErrorBoundaryProps {
  /** Display name shown in the error message, e.g. "Markets" */
  name: string;
  children: ReactNode;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Wraps a single tab so that a render crash shows an inline
 * error message instead of taking down the entire app.
 *
 * This is a class component because React does not provide a
 * hook-based API for catching render errors (componentDidCatch).
 */
export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[TabErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-amber-500/20 bg-card px-6 py-16 text-center">
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-amber-400">
            Tab Error
          </p>
          <h2 className="text-lg font-semibold text-foreground">
            {this.props.name} encountered an error
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Something went wrong rendering this tab. Other tabs are unaffected.
          </p>

          <button
            onClick={this.handleReset}
            className="mt-6 rounded-lg border border-primary/70 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            type="button"
          >
            Try again
          </button>

          {process.env.NODE_ENV === 'development' && this.state.error ? (
            <p className="mt-4 max-w-lg break-all text-xs text-muted-foreground">
              {this.state.error.message}
            </p>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}
