---
title: "Interface: BoundsExpectation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / BoundsExpectation

# Interface: BoundsExpectation

Defined in: [driver/src/api.ts:582](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L582)

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

### column?

> `readonly` `optional` **column?**: `number`

Defined in: [driver/src/api.ts:584](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L584)

***

### height?

> `readonly` `optional` **height?**: `number`

Defined in: [driver/src/api.ts:586](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L586)

***

### row?

> `readonly` `optional` **row?**: `number`

Defined in: [driver/src/api.ts:583](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L583)

***

### width?

> `readonly` `optional` **width?**: `number`

Defined in: [driver/src/api.ts:585](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L585)
