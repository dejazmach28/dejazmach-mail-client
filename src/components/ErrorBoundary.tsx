import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: string;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-shell">
          <div className="error-boundary-card">
            <span className="error-boundary-icon" aria-hidden="true">⚠</span>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-detail">{this.state.error}</p>
            <button
              className="btn-action btn-action-primary"
              onClick={() => this.setState({ hasError: false, error: "" })}
              type="button"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
