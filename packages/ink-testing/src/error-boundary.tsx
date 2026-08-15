/**
 * The error boundary `mountInk` wraps every tree in.
 *
 * Without it, a component that throws during render takes the whole Ink app
 * down: `waitUntilExit()` rejects somewhere the test is not awaiting, and the
 * failure surfaces as a timeout on the next locator instead of as the crash it
 * is. With it, the crash is a value the harness can hand back.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Props of {@link MountErrorBoundary}. */
export interface MountErrorBoundaryProps {
  readonly children: ReactNode;
  /** Called once per caught error, with the error React threw. */
  readonly onError: (error: Error, info: ErrorInfo) => void;
}

interface MountErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Renders its children, or nothing once they have thrown.
 *
 * Rendering nothing rather than a fallback message keeps the failed frame
 * unambiguous: the screen is empty and `renderError()` explains why, instead of
 * a diagnostic string that a text locator could accidentally match.
 */
export class MountErrorBoundary extends Component<MountErrorBoundaryProps, MountErrorBoundaryState> {
  override state: MountErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MountErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
