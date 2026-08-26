---
title: "Interface: BoundsExpectation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / BoundsExpectation

# Interface: BoundsExpectation

Defined in: [driver/src/api.ts:757](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L757)

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

Defined in: [driver/src/api.ts:759](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L759)

***

### height?

> `readonly` `optional` **height?**: `number`

Defined in: [driver/src/api.ts:761](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L761)

***

### row?

> `readonly` `optional` **row?**: `number`

Defined in: [driver/src/api.ts:758](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L758)

***

### width?

> `readonly` `optional` **width?**: `number`

Defined in: [driver/src/api.ts:760](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L760)
