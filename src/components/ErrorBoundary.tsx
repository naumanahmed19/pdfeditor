import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("Unhandled UI error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-sidebar p-8">
        <div className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-shell">
          <p className="text-sm font-semibold">Something went wrong</p>
          <p className="break-words pt-2 text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
          <div className="flex justify-center gap-2 pt-4">
            <button
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => location.reload()}
            >
              Reload app
            </button>
            <button
              className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent"
              onClick={() => this.setState({ error: null })}
            >
              Try to continue
            </button>
          </div>
        </div>
      </div>
    );
  }
}
