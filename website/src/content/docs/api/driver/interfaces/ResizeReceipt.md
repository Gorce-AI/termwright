---
title: "Interface: ResizeReceipt"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ResizeReceipt

# Interface: ResizeReceipt

Defined in: [driver/src/api.ts:574](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L574)

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

Defined in: [driver/src/api.ts:577](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L577)

***

### before

> `readonly` **before**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:576](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L576)

***

### pairedRender

> `readonly` **pairedRender**: [`Observation`](../../type-aliases/observation/)\<`number`\>

Defined in: [driver/src/api.ts:579](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L579)

Revision that proves the child repainted at the new PTY size.

***

### requested

> `readonly` **requested**: `object`

Defined in: [driver/src/api.ts:575](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L575)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`
