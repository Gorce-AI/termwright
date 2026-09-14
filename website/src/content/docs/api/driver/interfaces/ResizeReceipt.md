---
title: "Interface: ResizeReceipt"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ResizeReceipt

# Interface: ResizeReceipt

Defined in: [driver/src/api.ts:784](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L784)

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

Defined in: [driver/src/api.ts:787](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L787)

***

### before

> `readonly` **before**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:786](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L786)

***

### pairedRender

> `readonly` **pairedRender**: [`Observation`](../../type-aliases/observation/)\<`number`\>

Defined in: [driver/src/api.ts:789](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L789)

Paired child render revision when a semantic adapter can prove one.

***

### requested

> `readonly` **requested**: `object`

Defined in: [driver/src/api.ts:785](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L785)

#### columns

> `readonly` **columns**: `number`

#### rows

> `readonly` **rows**: `number`
