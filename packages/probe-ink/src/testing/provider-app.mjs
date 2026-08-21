import React, {useEffect, useState} from 'react';
import {Box, Text, render} from 'ink';
import {registerEvidenceProvider} from '@termwright/evidence-provider';

const scenario = process.env['TERMWRIGHT_PROVIDER_SCENARIO'] ?? 'baseline';
let moved = false;
let wide = process.stdout.columns >= 50;

const approveColumn = 0;
function rejectColumn() {
  if (scenario === 'clipped') return 38;
  if (scenario === 'resize') return wide ? 27 : 11;
  return moved ? 19 : 11;
}

function region(name, column, viewportColumns) {
  const width = name === '[Approve]' ? 9 : 8;
  const to = Math.min(column + width, viewportColumns);
  return {
    recipient: {role: 'button', name},
    regionBounds: {row: 1, column, width, height: 1},
    spans: to > column ? [{row: 1, from: column, to}] : [],
  };
}

function routePointer(column, row) {
  if (row !== 1) return null;
  if (column >= approveColumn && column < approveColumn + 9) {
    return {role: 'button', name: '[Approve]'};
  }
  const reject = rejectColumn();
  return column >= reject && column < reject + 8
    ? {role: 'button', name: '[Reject]'}
    : null;
}

const registration = registerEvidenceProvider({
  id: 'permission-production-router',
  version: '1.0.0',
  method: scenario === 'region-only' ? 'declared' : 'native',
  capabilities: scenario === 'region-only' ? ['pointer-regions'] : ['pointer-regions', 'hit-test'],
  observe: ({columns}) => ({
    pointerRegions: [
      region('[Approve]', approveColumn, columns),
      region('[Reject]', rejectColumn(), columns),
    ],
    ...(scenario === 'region-only'
      ? {}
      : {
          hitTest: scenario === 'disagreement'
            ? (column, row) => {
                const target = routePointer(column, row);
                return target?.name === '[Reject]'
                  ? {role: 'button', name: '[Approve]'}
                  : target;
              }
            : routePointer,
        }),
  }),
});

function App() {
  const [last, setLast] = useState('none');
  const [, rerender] = useState(0);
  useEffect(() => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdout.write(`\u001b[?${scenario === 'hover' ? '1003' : '1002'}h\u001b[?1006h`);
    let dragSource = null;
    let dragMoved = false;
    const receive = (chunk) => {
      const text = chunk.toString('utf8');
      if (text === 'l') {
        registration.dispose();
        setLast('provider disposed');
        return;
      }
      if (text === 'm') {
        moved = !moved;
        setLast(`moved@${rejectColumn()}`);
        rerender((value) => value + 1);
        return;
      }
      for (const match of text.matchAll(/\u001b\[<(\d+);(\d+);(\d+)([Mm])/gu)) {
        const code = Number(match[1]);
        const column = Number(match[2]) - 1;
        const row = Number(match[3]) - 1;
        const target = routePointer(column, row);
        const released = match[4] === 'm';
        const motion = (code & 32) !== 0;
        if (!released && !motion) {
          dragSource = target?.name ?? null;
          dragMoved = false;
          continue;
        }
        if (motion) {
          dragMoved = dragSource !== null;
          if (scenario === 'hover' && dragSource === null && target !== null) {
            setLast(`hover ${target.name}@${column}`);
          }
          continue;
        }
        if (released && dragSource !== null) {
          if (dragMoved && target !== null && target.name !== dragSource) {
            setLast(`drag ${dragSource}->${target.name}`);
          } else if (target?.name === '[Reject]') {
            setLast(`reject@${column}`);
          } else if (target?.name === '[Approve]') {
            setLast(`approve@${column}`);
          }
          dragSource = null;
        }
      }
    };
    const resize = () => {
      wide = process.stdout.columns >= 50;
      setLast(`resize ${process.stdout.columns} reject@${rejectColumn()}`);
      rerender((value) => value + 1);
    };
    process.stdin.on('data', receive);
    process.stdout.on('resize', resize);
    return () => {
      process.stdin.off('data', receive);
      process.stdout.off('resize', resize);
      process.stdin.setRawMode?.(false);
      process.stdout.write(`\u001b[?${scenario === 'hover' ? '1003' : '1002'}l\u001b[?1006l`);
    };
  }, []);
  const gap = Math.max(0, rejectColumn() - 9);
  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(Text, null, 'Permission required'),
    React.createElement(
      Box,
      null,
      React.createElement(Box, {'aria-role': 'button'}, React.createElement(Text, null, '[Approve]')),
      React.createElement(Text, null, ' '.repeat(gap)),
      React.createElement(Box, {'aria-role': 'button'}, React.createElement(Text, null, '[Reject]')),
    ),
    React.createElement(Text, null, `last: ${last}`),
  );
}

const app = render(React.createElement(App), {interactive: true, patchConsole: false, maxFps: 120});
await app.waitUntilExit();
