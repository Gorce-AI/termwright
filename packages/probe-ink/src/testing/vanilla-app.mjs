/**
 * An ordinary Ink application. It imports React and Ink only, then calls the
 * framework's normal `render`; zero-config tests must not weaken that premise.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, render, useApp } from 'ink';

const maxStep = Number(process.env['TW_APP_STEPS'] ?? '2');

function App() {
  const [step, setStep] = useState(0);
  const { exit } = useApp();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (step >= maxStep) exit();
      else setStep(step + 1);
    }, 90);
    return () => clearTimeout(timer);
  }, [exit, step]);

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, null, `Count ${step}`),
    React.createElement(Box, { 'aria-role': 'button' }, React.createElement(Text, null, 'Approve')),
    React.createElement(Box, null, React.createElement(Text, null, `Generic child ${step}`)),
  );
}

const app = render(React.createElement(App), {
  interactive: false,
  patchConsole: false,
  maxFps: 60,
});
await app.waitUntilExit();
