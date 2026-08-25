---
title: "Interface: MousePoint"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / MousePoint

# Interface: MousePoint

Defined in: [driver/src/api.ts:270](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L270)

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

### column

> `readonly` **column**: `number`

Defined in: [driver/src/api.ts:272](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L272)

***

### row

> `readonly` **row**: `number`

Defined in: [driver/src/api.ts:271](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L271)
