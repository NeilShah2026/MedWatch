import { Component, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/States';
import { logger } from '@/lib/logger';

/** Catches render errors and shows a generic message — never stack traces or data (spec §9). */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    logger.error('ui.render_error', {
      route: window.location.pathname.split('/').slice(0, 2).join('/'),
    });
  }
  override componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }
  override render() {
    if (this.state.failed) return <ErrorState onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}
