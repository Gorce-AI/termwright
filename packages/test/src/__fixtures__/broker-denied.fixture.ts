import { launchTerminal } from '@termwright/driver';
import { test } from 'vitest';

const marker = process.env['TERMWRIGHT_DENIED_SPAWN_MARKER'];
if (marker === undefined) throw new Error('TERMWRIGHT_DENIED_SPAWN_MARKER is required');

test('resource denial happens before spawn', async () => {
  await launchTerminal({
    command: [
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`,
    ],
  });
});
