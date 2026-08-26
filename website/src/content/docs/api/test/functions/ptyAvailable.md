---
title: "Function: ptyAvailable()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / ptyAvailable

# Function: ptyAvailable()

> **ptyAvailable**(): `Promise`\<`boolean`\>

Defined in: [test/src/pty-available.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/pty-available.ts#L55)

Whether this machine can open a pseudo-terminal.

Loads and validates the native backend without spawning a process. The real
launch stays inside the resource-aware test attempt, where failure is a red
test rather than a collection-time skip and host admission is enforceable.

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
