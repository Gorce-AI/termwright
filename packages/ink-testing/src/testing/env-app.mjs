/**
 * A component that renders one environment variable, so a test can see exactly
 * what the application it drives was given.
 *
 * Like `counter-app.mjs`, this is plain JavaScript so that both modes can
 * import the same file — which is the whole point here, since the question
 * under test is what differs between them.
 */

import { createElement } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * @param {{name?: string}} props
 */
export default function EnvApp({ name = 'TW_PROBE' }) {
  // Raw mode is what keeps the process alive. A fixture that renders once and
  // handles no input has nothing referencing the event loop, so Node drains it
  // and Ink unmounts on `beforeExit` — the harness then finds a process that
  // exited cleanly before it could look at anything.
  useInput(() => {});

  const value = process.env[name];
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, null, `${name}=${value ?? '<unset>'}`),
    createElement(Text, null, `PATH=${process.env['PATH'] === undefined ? '<unset>' : '<set>'}`),
  );
}
