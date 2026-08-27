/** Small normal-render Ink process used only by cross-package readiness tests. */

import { createElement, useEffect, useRef } from 'react';
import { Box, Text, render, useApp } from 'ink';
import { useSemantic } from '@termwright/ink';

function App() {
  const { exit } = useApp();
  const status = useRef(null);
  useSemantic(status, { role: 'status', name: 'Ready', testId: 'status' });
  useEffect(() => {
    const timer = setTimeout(exit, 2_000);
    return () => clearTimeout(timer);
  }, [exit]);
  return createElement(
    Box,
    { ref: status, flexDirection: 'column' },
    createElement(Text, null, 'Termwright Conformance'),
  );
}

const app = render(createElement(App), { alternateScreen: true, interactive: true });
await app.waitUntilExit();
