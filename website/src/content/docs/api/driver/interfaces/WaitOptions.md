---
title: "Interface: WaitOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / WaitOptions

# Interface: WaitOptions

Defined in: [api.ts:398](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L398)

`@termwright/driver` — PTY + VT sessions, locators, actions and waits.

The normative public API lives in `api.ts`; this module is the only entry
point and re-exports the types from there together with their runtime
implementations.

## Example

```ts
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', 'app.js'] });
await terminal.waitForText('Ready');
await terminal.getByRole('button', { name: 'Approve' }).activate();
await terminal.close();
```

## Extended by

- [`PointerOptions`](../pointeroptions/)
- [`ShellRunOptions`](../shellrunoptions/)

## Properties

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [api.ts:399](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L399)
