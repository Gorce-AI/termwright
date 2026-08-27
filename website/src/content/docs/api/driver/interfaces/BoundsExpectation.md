---
title: "Interface: BoundsExpectation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / BoundsExpectation

# Interface: BoundsExpectation

Defined in: [driver/src/api.ts:721](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L721)

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

Defined in: [driver/src/api.ts:723](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L723)

***

### height?

> `readonly` `optional` **height?**: `number`

Defined in: [driver/src/api.ts:725](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L725)

***

### row?

> `readonly` `optional` **row?**: `number`

Defined in: [driver/src/api.ts:722](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L722)

***

### width?

> `readonly` `optional` **width?**: `number`

Defined in: [driver/src/api.ts:724](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L724)
