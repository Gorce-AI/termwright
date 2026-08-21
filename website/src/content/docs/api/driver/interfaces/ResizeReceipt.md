---
title: "Interface: ResizeReceipt"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ResizeReceipt

# Interface: ResizeReceipt

Defined in: [api.ts:457](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L457)

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

### after

> `readonly` **after**: `ObservationStamp`

Defined in: [api.ts:460](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L460)

***

### before

> `readonly` **before**: `ObservationStamp`

Defined in: [api.ts:459](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L459)

***

### pairedRender

> `readonly` **pairedRender**: `Observation`\<`number`\>

Defined in: [api.ts:462](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L462)

Revision that proves the child repainted at the new PTY size.

***

### requested

> `readonly` **requested**: `object`

Defined in: [api.ts:458](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L458)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`
