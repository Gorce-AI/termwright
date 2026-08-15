/**
 * Types for `env-app.mjs`.
 */

import type { ReactElement } from 'react';

/** Props of the environment-probe component. */
export interface EnvAppProps {
  /** Variable to render. Default `TW_PROBE`. */
  readonly name?: string;
}

declare function EnvApp(props: EnvAppProps): ReactElement;

export default EnvApp;
