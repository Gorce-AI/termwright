import React, { useEffect, useState } from 'react';
import { Box, Static, Text, render, useApp } from 'ink';

const mode = process.env['TW_INK_GEOMETRY_MODE'] ?? 'main';

function App() {
  const [step, setStep] = useState(0);
  const { exit } = useApp();

  useEffect(() => {
    const timers =
      mode === 'rapid' ? [setTimeout(() => setStep(1), 20), setTimeout(() => setStep(2), 21)] : [];
    const receive = (chunk) => {
      const value = chunk.toString('utf8');
      if (value.includes('q')) exit();
      if (value.includes('n')) setStep((current) => current + 1);
    };
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', receive);
    return () => {
      for (const timer of timers) clearTimeout(timer);
      process.stdin.off('data', receive);
      process.stdin.setRawMode?.(false);
    };
  }, [exit]);

  const live =
    mode === 'clip'
      ? React.createElement(
          Box,
          { width: 8, height: 3, overflow: 'hidden', borderStyle: 'single' },
          React.createElement(
            Box,
            { marginLeft: 4, width: 8, flexShrink: 0 },
            React.createElement(Text, null, 'CLIPPED-WIDE'),
          ),
        )
      : mode === 'scroll'
        ? React.createElement(
            Box,
            { flexDirection: 'column' },
            ...Array.from({ length: 12 }, (_, index) =>
              React.createElement(Text, { key: index }, `LINE-${index}`),
            ),
          )
        : mode === 'resize'
          ? React.createElement(
              Box,
              { width: '100%', 'aria-role': 'button' },
              React.createElement(Text, null, 'RESIZE'),
            )
          : React.createElement(
              Box,
              { flexDirection: 'column' },
              mode === 'hidden'
                ? React.createElement(
                    Box,
                    { display: step === 0 ? 'none' : 'flex' },
                    React.createElement(Text, null, 'HIDDEN'),
                  )
                : null,
              React.createElement(Text, null, `LIVE-${step}`),
              React.createElement(
                Box,
                { width: 5 },
                React.createElement(Text, { wrap: 'wrap' }, '界界界界'),
              ),
            );

  return React.createElement(
    React.Fragment,
    null,
    mode === 'static'
      ? React.createElement(
          Static,
          { items: step === 0 ? ['HISTORY'] : ['HISTORY', 'HISTORY-1'] },
          (item) => React.createElement(Text, { key: item }, item),
        )
      : null,
    live,
  );
}

const app = render(React.createElement(App), {
  interactive: true,
  alternateScreen: mode === 'alternate',
  patchConsole: false,
  maxFps: 120,
});
await app.waitUntilExit();
