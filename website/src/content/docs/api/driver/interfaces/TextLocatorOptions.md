---
title: "Interface: TextLocatorOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TextLocatorOptions

# Interface: TextLocatorOptions

Defined in: [api.ts:389](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L389)

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

### attributes?

> `readonly` `optional` **attributes?**: `Partial`\<[`CellAttributes`](../cellattributes/)\>

Defined in: [api.ts:395](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L395)

***

### bg?

> `readonly` `optional` **bg?**: `string`

Defined in: [api.ts:394](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L394)

***

### exact?

> `readonly` `optional` **exact?**: `boolean`

Defined in: [api.ts:390](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L390)

***

### fg?

> `readonly` `optional` **fg?**: `string`

Defined in: [api.ts:393](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L393)

Style predicates for generic (non-semantic) matching.

***

### occurrence?

> `readonly` `optional` **occurrence?**: `number`

Defined in: [api.ts:391](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L391)
