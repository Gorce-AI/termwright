---
title: "Interface: LocatorWheelOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorWheelOptions

# Interface: LocatorWheelOptions

Defined in: [driver/src/api.ts:485](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L485)

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

### deltaX?

> `readonly` `optional` **deltaX?**: `number`

Defined in: [driver/src/api.ts:488](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L488)

***

### deltaY?

> `readonly` `optional` **deltaY?**: `number`

Defined in: [driver/src/api.ts:487](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L487)

***

### modifiers?

> `readonly` `optional` **modifiers?**: readonly [`MouseModifier`](../../type-aliases/mousemodifier/)[]

Defined in: [driver/src/api.ts:246](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L246)

#### Inherited from

[`MouseModifierOptions`](../mousemodifieroptions/).[`modifiers`](../mousemodifieroptions/#modifiers)

***

### position?

> `readonly` `optional` **position?**: `object`

Defined in: [driver/src/api.ts:486](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L486)

#### columnOffset

> `readonly` **columnOffset**: `number`

#### rowOffset

> `readonly` **rowOffset**: `number`

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:475](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L475)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)
