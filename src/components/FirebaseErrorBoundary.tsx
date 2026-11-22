import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class FirebaseErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application boundary caught error:', error.message, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      let friendly = 'Something went wrong while loading this view.';
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string };
        if (parsed?.error) {
          friendly = 'Unable to complete the data request with your current permissions.';
        }
      } catch {
        // Non-JSON error message falls back cleanly
      }

      return (
        <div className="min-h-screen bg-[#09090E] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#111118] border border-white/[0.1] rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-semibold text-white">Unable to Load Page</h1>
            <p className="text-sm text-zinc-400">{friendly}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-4 py-2 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
