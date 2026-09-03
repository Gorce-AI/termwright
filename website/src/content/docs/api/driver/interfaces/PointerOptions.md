---
title: "Interface: PointerOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / PointerOptions

# Interface: PointerOptions

Defined in: [driver/src/api.ts:762](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L762)

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

- [`WaitOptions`](../waitoptions/).[`MouseModifierOptions`](../mousemodifieroptions/)

## Properties

### button?

> `readonly` `optional` **button?**: `"left"` \| `"middle"` \| `"right"`

Defined in: [driver/src/api.ts:763](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L763)

***

### modifiers?

> `readonly` `optional` **modifiers?**: readonly [`MouseModifier`](../../type-aliases/mousemodifier/)[]

Defined in: [driver/src/api.ts:307](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L307)

#### Inherited from

[`MouseModifierOptions`](../mousemodifieroptions/).[`modifiers`](../mousemodifieroptions/#modifiers)

***

### position?

> `readonly` `optional` **position?**: `object`

Defined in: [driver/src/api.ts:764](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L764)

#### columnOffset

> `readonly` **columnOffset**: `number`

#### rowOffset

> `readonly` **rowOffset**: `number`

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:561](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L561)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)
