---
title: "Interface: CellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellSnapshot

# Interface: CellSnapshot

Defined in: [driver/src/api.ts:334](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L334)

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

Defined in: [driver/src/api.ts:339](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L339)

***

### bg

> `readonly` **bg**: [`CellColor`](../../type-aliases/cellcolor/)

Defined in: [driver/src/api.ts:338](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L338)

***

### char

> `readonly` **char**: `string`

Defined in: [driver/src/api.ts:335](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L335)

***

### fg

> `readonly` **fg**: [`CellColor`](../../type-aliases/cellcolor/)

Defined in: [driver/src/api.ts:337](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L337)

***

### link?

> `readonly` `optional` **link?**: [`CellLink`](../celllink/)

Defined in: [driver/src/api.ts:341](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L341)

The OSC 8 hyperlink covering this cell, when it has one.

***

### width

> `readonly` **width**: `0` \| `1` \| `2`

Defined in: [driver/src/api.ts:336](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L336)
