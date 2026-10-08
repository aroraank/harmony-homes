import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Last-resort error screen so a render bug never leaves a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div className="max-w-sm">
          <img src="/icons/logo.svg" alt="" className="mx-auto mb-4 size-14" />
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">Please reload the app. Your data is safe — nothing was saved halfway.</p>
          <button
            type="button"
            className="mt-5 h-11 cursor-pointer rounded-xl bg-primary px-5 font-semibold text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
