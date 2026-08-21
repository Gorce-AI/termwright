---
title: "Interface: BoundsExpectation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / BoundsExpectation

# Interface: BoundsExpectation

Defined in: [api.ts:465](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L465)

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

Defined in: [api.ts:467](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L467)

***

### height?

> `readonly` `optional` **height?**: `number`

Defined in: [api.ts:469](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L469)

***

### row?

> `readonly` `optional` **row?**: `number`

Defined in: [api.ts:466](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L466)

***

### width?

> `readonly` `optional` **width?**: `number`

Defined in: [api.ts:468](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L468)
