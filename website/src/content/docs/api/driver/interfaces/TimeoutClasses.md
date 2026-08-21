---
title: "Interface: TimeoutClasses"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TimeoutClasses

# Interface: TimeoutClasses

Defined in: [api.ts:28](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L28)

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

Defined in: [api.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L29)

***

### exit?

> `readonly` `optional` **exit?**: `number`

Defined in: [api.ts:33](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L33)

***

### idle?

> `readonly` `optional` **idle?**: `number`

Defined in: [api.ts:31](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L31)

***

### ready?

> `readonly` `optional` **ready?**: `number`

Defined in: [api.ts:32](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L32)

***

### text?

> `readonly` `optional` **text?**: `number`

Defined in: [api.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L30)
