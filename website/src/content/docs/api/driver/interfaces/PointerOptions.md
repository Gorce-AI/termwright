---
title: "Interface: PointerOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / PointerOptions

# Interface: PointerOptions

Defined in: [api.ts:477](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L477)

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

## Extends

- [`WaitOptions`](../waitoptions/)

## Properties

### button?

> `readonly` `optional` **button?**: `"left"` \| `"middle"` \| `"right"`

Defined in: [api.ts:478](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L478)

***

### position?

> `readonly` `optional` **position?**: `object`

Defined in: [api.ts:479](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L479)

#### columnOffset

> `readonly` **columnOffset**: `number`

#### rowOffset

> `readonly` **rowOffset**: `number`

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [api.ts:399](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L399)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)
