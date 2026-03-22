import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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
        <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-[#1a1d27] p-8 shadow-lg">
            {/* Icon */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 border border-red-500/30">
                <svg
                  className="h-5 w-5 text-red-400"
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
              <h2 className="text-lg font-semibold text-[#e2e8f0]">
                Something went wrong
              </h2>
            </div>

            {/* Divider */}
            <div className="mb-5 h-px bg-[#2a2f45]" />

            {/* Error message */}
            <div className="mb-6 rounded-lg bg-[#0f1117] border border-[#2a2f45] p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#64748b]">
                Error
              </p>
              <p className="font-mono text-sm text-red-400 break-words">
                {this.state.error?.message ?? 'An unexpected error occurred.'}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={this.handleRetry}
                className="flex-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 hover:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg border border-[#2a2f45] px-4 py-2.5 text-sm font-medium text-[#64748b] transition-colors hover:border-[#3a4055] hover:text-[#e2e8f0] focus:outline-none focus:ring-2 focus:ring-[#2a2f45]"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
