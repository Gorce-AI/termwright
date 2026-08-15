/**
 * Process-mode half of the component-harness matrix (§20.2a): mounts the shared
 * {@link Probe} component in a real PTY, under the same wrapper context an
 * in-process harness would supply.
 *
 * Documented process-mode differences from an in-process mount:
 *   - the callback passed to `onChange` cannot be observed by the test
 *     directly, so it is rendered onto the screen as `changed: <n>` instead;
 *   - unmount is requested with `q` over the PTY rather than by calling
 *     `unmount()`.
 *
 * `--step=<n>` sets the prop the component increments by, so the same fixture
 * covers prop-driven rerender across a relaunch.
 */

import { createElement as h, useState } from 'react';
import { Box, Text, useApp, useStdin } from 'ink';
import { useEffect } from 'react';
import { semanticRender } from '@termwright/ink';
import { LabelContext, Probe } from './component.mjs';

const stepArg = process.argv.find((argument) => argument.startsWith('--step='));
const step = stepArg === undefined ? 1 : Number(stepArg.slice('--step='.length));

function Host() {
  const { exit } = useApp();
  const { stdin, setRawMode } = useStdin();
  const [changed, setChanged] = useState('none');

  useEffect(() => {
    setRawMode(true);
    const onData = (chunk) => {
      if (chunk.toString('utf8').includes('q')) exit();
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, setRawMode, exit]);

  return h(
    LabelContext.Provider,
    { value: 'wrapped' },
    h(
      Box,
      { flexDirection: 'column' },
      h(Probe, { key: 'probe', step, onChange: (next) => setChanged(String(next)) }),
      h(Text, { key: 'changed' }, `changed: ${changed}`),
    ),
  );
}

const app = semanticRender(h(Host), { alternateScreen: true, interactive: true });
await app.waitUntilExit();
process.stdout.write('BYE\r\n');
