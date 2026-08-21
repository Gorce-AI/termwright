---
title: "Interface: CellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellSnapshot

# Interface: CellSnapshot

Defined in: [api.ts:262](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L262)

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

### attributes

> `readonly` **attributes**: [`CellAttributes`](../cellattributes/)

Defined in: [api.ts:267](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L267)

***

### bg

> `readonly` **bg**: [`CellColor`](../../type-aliases/cellcolor/)

Defined in: [api.ts:266](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L266)

***

### char

> `readonly` **char**: `string`

Defined in: [api.ts:263](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L263)

***

### fg

> `readonly` **fg**: [`CellColor`](../../type-aliases/cellcolor/)

Defined in: [api.ts:265](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L265)

***

### link?

> `readonly` `optional` **link?**: [`CellLink`](../celllink/)

Defined in: [api.ts:269](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L269)

The OSC 8 hyperlink covering this cell, when it has one.

***

### width

> `readonly` **width**: `0` \| `1` \| `2`

Defined in: [api.ts:264](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L264)
