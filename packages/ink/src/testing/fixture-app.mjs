/**
 * Fixture application for the real-process marker test.
 *
 * Runs in its own Node process against the *built* package, so the test
 * exercises what a user would actually install: `semanticRender` writing real
 * frames and real DCS markers to a real stdout pipe.
 *
 * Env: TW_LABELS — comma-separated labels, rendered one after another.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { semanticRender, useSemantic } from '../../dist/index.js';

const labels = (process.env['TW_LABELS'] ?? 'Approve,Reject').split(',');

function App({ label }) {
  const ref = React.useRef(null);
  useSemantic(ref, { role: 'button', name: label, testId: 'action' });

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Box, { ref }, React.createElement(Text, null, label)),
  );
}

const app = semanticRender(React.createElement(App, { label: labels[0] }), {
  stdout: process.stdout,
  interactive: true,
  alternateScreen: true,
  patchConsole: false,
  exitOnCtrlC: false,
});

let index = 1;

const step = () => {
  if (index < labels.length) {
    app.rerender(React.createElement(App, { label: labels[index] }));
    index += 1;
    setTimeout(step, 250);
    return;
  }
  app.unmount();
  process.stdout.write('', () => {
    process.exit(0);
  });
};

setTimeout(step, 250);
