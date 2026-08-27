/** Ordinary Ink render plus the optional annotation-only SDK. */

import React, { useEffect, useRef } from 'react';
import { Box, Text, render, useApp } from 'ink';
// This is an internal cross-package fixture. Import the already-built workspace
// artifact directly so probe-ink does not need a reverse devDependency on Ink;
// Ink itself depends on probe-ink for launchInkFixture, and that cycle makes
// clean parallel declaration builds nondeterministic.
import { useSemantic } from '../../../ink/dist/index.js';

function App() {
  const { exit } = useApp();
  const labelRef = useRef(null);
  const deployRef = useRef(null);

  useSemantic(labelRef, { role: 'text', name: 'Deployment target', testId: 'deploy-label' });
  useSemantic(deployRef, {
    role: 'button',
    name: 'Deploy production',
    description: 'Starts the production deployment',
    testId: 'deploy-production',
    extended: { environment: 'production', retries: 2 },
    actions: ['activate'],
    labelledBy: [labelRef],
    describedBy: [labelRef],
  });

  useEffect(() => {
    const timer = setTimeout(exit, 180);
    return () => clearTimeout(timer);
  }, [exit]);

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Box, { ref: labelRef }, React.createElement(Text, null, 'Target')),
    React.createElement(
      Box,
      { ref: deployRef, 'aria-state': { disabled: true } },
      React.createElement(Text, null, 'Physical label'),
    ),
  );
}

const app = render(React.createElement(App), { interactive: false, patchConsole: false });
await app.waitUntilExit();
