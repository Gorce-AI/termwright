---
title: "Interface: ScreenTextLocatorOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenTextLocatorOptions

# Interface: ScreenTextLocatorOptions

Defined in: [driver/src/api.ts:528](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L528)

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

Defined in: [driver/src/api.ts:533](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L533)

***

### bg?

> `readonly` `optional` **bg?**: `string`

Defined in: [driver/src/api.ts:532](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L532)

***

### exact?

> `readonly` `optional` **exact?**: `boolean`

Defined in: [driver/src/api.ts:525](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L525)

#### Inherited from

[`TextLocatorOptions`](../textlocatoroptions/).[`exact`](../textlocatoroptions/#exact)

***

### fg?

> `readonly` `optional` **fg?**: `string`

Defined in: [driver/src/api.ts:531](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L531)

Style predicates evaluated against terminal cells.

***

### occurrence?

> `readonly` `optional` **occurrence?**: `number`

Defined in: [driver/src/api.ts:529](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L529)
