import { Component, type ReactNode } from "react";

/** One friendly message if rendering fails, instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="error" role="alert">
          Something went wrong on this screen. Reload the page to start a new session.
        </p>
      );
    }
    return this.props.children;
  }
}
