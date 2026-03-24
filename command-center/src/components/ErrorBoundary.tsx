import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /**
   * Custom fallback to render instead of the default error UI.
   */
  fallback?: ReactNode;
  /**
   * When true, renders a compact inline card that fits inside the page content
   * area (preserving the sidebar/header shell).  When false (default), renders
   * a full-screen takeover.
   */
  inline?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Shared error UI — theme-aware via CSS custom properties.
 * Exported so it can be used standalone in tests or Storybook.
 */
export function ErrorFallback({
  error,
  onRetry,
  inline,
}: {
  error: Error | null;
  onRetry: () => void;
  inline?: boolean;
}) {
  const card = (
    <div
      data-testid="error-boundary-card"
      className="w-full max-w-md rounded-xl border border-red-500/30 bg-[var(--color-surface)] p-8 shadow-lg"
    >
      {/* Icon + heading */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 border border-red-500/30 flex-shrink-0">
          <svg
            className="h-5 w-5 text-red-400"
            aria-hidden="true"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <h2
          data-testid="error-boundary-heading"
          className="text-lg font-semibold text-[var(--color-text)]"
        >
          Something went wrong
        </h2>
      </div>

      {/* Divider */}
      <div className="mb-5 h-px bg-[var(--color-border)]" />

      {/* Error message */}
      <div
        data-testid="error-boundary-message"
        className="mb-6 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-4"
      >
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          Error
        </p>
        <p className="font-mono text-sm text-red-400 break-words">
          {error?.message ?? 'An unexpected error occurred.'}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          data-testid="error-boundary-retry"
          onClick={onRetry}
          className="flex-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 hover:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          Try again
        </button>
        <button
          data-testid="error-boundary-reload"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-dim)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-border)]"
        >
          Reload page
        </button>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div
        data-testid="error-boundary-inline"
        className="flex items-center justify-center p-6 animate-fade-in"
      >
        {card}
      </div>
    );
  }

  return (
    <div
      data-testid="error-boundary-fullscreen"
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--color-bg)' }}
    >
      {card}
    </div>
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
          inline={this.props.inline}
        />
      );
    }

    return this.props.children;
  }
}
