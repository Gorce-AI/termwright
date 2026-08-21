---
title: "Interface: MouseModifierOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / MouseModifierOptions

# Interface: MouseModifierOptions

Defined in: [driver/src/api.ts:240](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L240)

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

## Extended by

- [`LocatorDragOptions`](../locatordragoptions/)
- [`LocatorWheelOptions`](../locatorwheeloptions/)
- [`PointerOptions`](../pointeroptions/)

## Properties

### modifiers?

> `readonly` `optional` **modifiers?**: readonly [`MouseModifier`](../../type-aliases/mousemodifier/)[]

Defined in: [driver/src/api.ts:241](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L241)
