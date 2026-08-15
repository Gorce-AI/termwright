/**
 * Shared access to the headless emulator.
 *
 * `@xterm/headless` 6.0 publishes a CommonJS `main` behind an ESM-shaped
 * `.d.ts`: `import { Terminal } from '@xterm/headless'` type-checks and then
 * throws "Terminal is not a constructor" at runtime. `createRequire` is the
 * workaround, and it lives here so only one file has to know about it.
 *
 * @internal
 */

import { createRequire } from 'node:module';
import type { Terminal as TerminalType } from '@xterm/headless';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless');

/** Creates a headless terminal with no scrollback — screenshots are viewport-only. */
export function createTerminal(columns: number, rows: number): TerminalType {
  return new Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 0 });
}

/** `terminal.write` as a promise; the callback fires once the parser drains. */
export function writeToTerminal(terminal: TerminalType, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}
