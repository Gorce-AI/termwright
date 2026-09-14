---
title: "Interface: ScreenTextLocatorOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenTextLocatorOptions

# Interface: ScreenTextLocatorOptions

Defined in: [driver/src/api.ts:589](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L589)

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

- [`TextLocatorOptions`](../textlocatoroptions/)

## Properties

### attributes?

> `readonly` `optional` **attributes?**: `Partial`\<[`CellAttributes`](../cellattributes/)\>

Defined in: [driver/src/api.ts:594](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L594)

***

### bg?

> `readonly` `optional` **bg?**: `string`

Defined in: [driver/src/api.ts:593](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L593)

***

### exact?

> `readonly` `optional` **exact?**: `boolean`

Defined in: [driver/src/api.ts:586](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L586)

#### Inherited from

[`TextLocatorOptions`](../textlocatoroptions/).[`exact`](../textlocatoroptions/#exact)

***

### fg?

> `readonly` `optional` **fg?**: `string`

Defined in: [driver/src/api.ts:592](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L592)

Style predicates evaluated against terminal cells.

***

### occurrence?

> `readonly` `optional` **occurrence?**: `number`

Defined in: [driver/src/api.ts:590](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L590)
