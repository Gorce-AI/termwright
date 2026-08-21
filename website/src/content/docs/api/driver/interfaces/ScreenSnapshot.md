---
title: "Interface: ScreenSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenSnapshot

# Interface: ScreenSnapshot

Defined in: [driver/src/api.ts:413](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L413)

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

### buffer

> `readonly` **buffer**: `"normal"` \| `"alternate"`

Defined in: [driver/src/api.ts:417](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L417)

***

### columns

> `readonly` **columns**: `number`

Defined in: [driver/src/api.ts:415](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L415)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:418](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L418)

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:419](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L419)

***

### revision

> `readonly` **revision**: `number`

Defined in: [driver/src/api.ts:414](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L414)

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:416](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L416)

## Methods

### ansi()

> **ansi**(): `string`

Defined in: [driver/src/api.ts:425](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L425)

ANSI-styled serialization of the visible grid (addon-serialize).

#### Returns

`string`

***

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:423](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L423)

#### Parameters

##### row

`number`

##### column

`number`

#### Returns

[`CellSnapshot`](../cellsnapshot/)

***

### html()

> **html**(): `string`

Defined in: [driver/src/api.ts:426](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L426)

#### Returns

`string`

***

### line()

> **line**(`row`): `string`

Defined in: [driver/src/api.ts:422](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L422)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:421](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L421)

Visible grid text, one string per row (trailing whitespace trimmed).

#### Returns

`string`
