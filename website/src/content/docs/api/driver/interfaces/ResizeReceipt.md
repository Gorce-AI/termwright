---
title: "Interface: ResizeReceipt"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ResizeReceipt

# Interface: ResizeReceipt

Defined in: [driver/src/api.ts:790](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L790)

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

Defined in: [driver/src/api.ts:793](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L793)

***

### before

> `readonly` **before**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:792](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L792)

***

### pairedRender

> `readonly` **pairedRender**: [`Observation`](../../type-aliases/observation/)\<`number`\>

Defined in: [driver/src/api.ts:795](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L795)

Paired child render revision when a semantic adapter can prove one.

***

### requested

> `readonly` **requested**: `object`

Defined in: [driver/src/api.ts:791](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L791)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`
