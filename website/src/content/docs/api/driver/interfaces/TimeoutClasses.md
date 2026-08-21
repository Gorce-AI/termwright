---
title: "Interface: TimeoutClasses"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TimeoutClasses

# Interface: TimeoutClasses

Defined in: [driver/src/api.ts:34](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L34)

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

### action?

> `readonly` `optional` **action?**: `number`

Defined in: [driver/src/api.ts:35](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L35)

***

### exit?

> `readonly` `optional` **exit?**: `number`

Defined in: [driver/src/api.ts:39](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L39)

***

### idle?

> `readonly` `optional` **idle?**: `number`

Defined in: [driver/src/api.ts:37](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L37)

***

### ready?

> `readonly` `optional` **ready?**: `number`

Defined in: [driver/src/api.ts:38](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L38)

***

### text?

> `readonly` `optional` **text?**: `number`

Defined in: [driver/src/api.ts:36](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L36)
