import { Component, type ReactNode } from 'react';

/** Błąd w jednym panelu nie wyłącza całej aplikacji. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="error-box">
          Błąd w części „{this.props.label}”: {this.state.error.message}{' '}
          <button onClick={() => this.setState({ error: null })}>Spróbuj ponownie</button>
        </div>
      );
    return this.props.children;
  }
}
