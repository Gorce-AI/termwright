---
title: "Interface: MousePoint"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / MousePoint

# Interface: MousePoint

Defined in: [driver/src/api.ts:299](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L299)

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

Defined in: [driver/src/api.ts:301](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L301)

***

### row

> `readonly` **row**: `number`

Defined in: [driver/src/api.ts:300](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L300)
