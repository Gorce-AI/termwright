---
title: "Interface: LocatorDragOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorDragOptions

# Interface: LocatorDragOptions

Defined in: [driver/src/api.ts:535](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L535)

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

### modifiers?

> `readonly` `optional` **modifiers?**: readonly [`MouseModifier`](../../type-aliases/mousemodifier/)[]

Defined in: [driver/src/api.ts:278](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L278)

#### Inherited from

[`MouseModifierOptions`](../mousemodifieroptions/).[`modifiers`](../mousemodifieroptions/#modifiers)

***

### path?

> `readonly` `optional` **path?**: readonly [`MousePoint`](../mousepoint/)[]

Defined in: [driver/src/api.ts:539](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L539)

Explicit viewport-cell path. The resolved destination is appended.

***

### steps?

> `readonly` `optional` **steps?**: `number`

Defined in: [driver/src/api.ts:537](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L537)

Number of interpolated pointer moves. Defaults to the cell distance.

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:532](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L532)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)
