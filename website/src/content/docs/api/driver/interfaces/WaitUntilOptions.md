---
title: "Interface: WaitUntilOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / WaitUntilOptions

# Interface: WaitUntilOptions\<T\>

Defined in: [driver/src/api.ts:179](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L179)

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

## Type Parameters

### T

`T`

## Properties

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [driver/src/api.ts:183](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L183)

Names the condition in timeout diagnostics.

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:598](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L598)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)

***

### until

> `readonly` **until**: (`value`) => `boolean` \| `Promise`\<`boolean`\>

Defined in: [driver/src/api.ts:181](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L181)

The wait completes when this returns true for the newly observed value.

#### Parameters

##### value

`T`

#### Returns

`boolean` \| `Promise`\<`boolean`\>
