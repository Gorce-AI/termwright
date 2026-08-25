/**
 * Types for `counter-app.mjs`. The component itself is untyped JavaScript so
 * that a fixture process can import it without a build step.
 */

import type { ReactElement } from 'react';

/** Props of the shared test component. */
export interface CounterAppProps {
  /** Accessible name of the button. Default `Approve`. */
  readonly label?: string;
  /** Line rendered above the button. Default `ready`. */
  readonly greeting?: string;
  /** Called on every physical press of the button. In-process mounts only. */
  readonly onPress?: () => void;
}

declare function CounterApp(props: CounterAppProps): ReactElement;

export default CounterApp;
