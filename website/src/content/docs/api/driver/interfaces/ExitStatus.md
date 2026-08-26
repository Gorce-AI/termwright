---
title: "Interface: ExitStatus"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ExitStatus

# Interface: ExitStatus

Defined in: [driver/src/api.ts:376](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L376)

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

## Properties

### code

> `readonly` **code**: `number` \| `null`

Defined in: [driver/src/api.ts:377](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L377)

***

### signal

> `readonly` **signal**: `string` \| `null`

Defined in: [driver/src/api.ts:378](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L378)
