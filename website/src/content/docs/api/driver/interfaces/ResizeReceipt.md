---
title: "Interface: ResizeReceipt"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ResizeReceipt

# Interface: ResizeReceipt

Defined in: [driver/src/api.ts:713](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L713)

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

> `readonly` **after**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:716](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L716)

***

### before

> `readonly` **before**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:715](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L715)

***

### pairedRender

> `readonly` **pairedRender**: [`Observation`](../../type-aliases/observation/)\<`number`\>

Defined in: [driver/src/api.ts:718](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L718)

Revision that proves the child repainted at the new PTY size.

***

### requested

> `readonly` **requested**: `object`

Defined in: [driver/src/api.ts:714](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L714)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`
