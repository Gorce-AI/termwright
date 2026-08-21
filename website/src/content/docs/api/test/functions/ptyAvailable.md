---
title: "Function: ptyAvailable()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ptyAvailable

# Function: ptyAvailable()

> **ptyAvailable**(): `Promise`\<`boolean`\>

Defined in: [test/src/pty-available.ts:40](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/pty-available.ts#L40)

Whether this machine can open a pseudo-terminal.

Spawns the shortest-lived process there is and disposes it. The result is
memoized: it cannot change within a process, and probing per test file would
spawn one process per file for no information.

Set `TERMWRIGHT_SKIP_PTY=1` to answer `false` without probing — the escape
hatch for skipping PTY suites deliberately.

## Returns

`Promise`\<`boolean`\>

## Example

```ts
import { describe } from 'vitest';
import { ptyAvailable, test } from '@termwright/test';

const pty = await ptyAvailable();

describe.skipIf(!pty)('the app', () => {
  test('starts', async ({ terminal }) => {
    const app = await terminal.launch({ command: ['node', 'app.js'] });
    await app.waitForText('ready');
  });
});
```
