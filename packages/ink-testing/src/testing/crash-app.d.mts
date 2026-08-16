/**
 * Types for `crash-app.mjs`.
 */

import type { ReactElement } from 'react';

/** Props of the crashing fixture component. */
export interface CrashAppProps {
  /** Line rendered above the status. Default `press any key`. */
  readonly label?: string;
}

declare function CrashApp(props: CrashAppProps): ReactElement;

export default CrashApp;
