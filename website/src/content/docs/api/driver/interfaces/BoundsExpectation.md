---
title: "Interface: BoundsExpectation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / BoundsExpectation

# Interface: BoundsExpectation

Defined in: [driver/src/api.ts:754](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L754)

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

Defined in: [driver/src/api.ts:756](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L756)

***

### height?

> `readonly` `optional` **height?**: `number`

Defined in: [driver/src/api.ts:758](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L758)

***

### row?

> `readonly` `optional` **row?**: `number`

Defined in: [driver/src/api.ts:755](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L755)

***

### width?

> `readonly` `optional` **width?**: `number`

Defined in: [driver/src/api.ts:757](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L757)
