/**
 * A fixture that dies the way real programs die: not on startup, where a
 * harness would notice immediately, but later, on input, from a throw nobody
 * catches.
 *
 * The throw is deferred to a timer on purpose. An error thrown inside the input
 * handler would be caught by React and turned into an unmount; this one escapes
 * to the process, which is what makes the exit unexpected — and therefore what
 * the driver reports as a crash.
 */

import { createElement } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * @param {{label?: string}} props
 */
export default function CrashApp({ label = 'press any key' }) {
  useInput(() => {
    setTimeout(() => {
      throw new Error('boom from the fixture');
    }, 0);
  });

  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, null, label),
    createElement(Text, null, 'still running'),
  );
}
