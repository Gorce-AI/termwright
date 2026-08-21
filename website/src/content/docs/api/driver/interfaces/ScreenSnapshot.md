---
title: "Interface: ScreenSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenSnapshot

# Interface: ScreenSnapshot

Defined in: [api.ts:340](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L340)

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

Defined in: [api.ts:344](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L344)

***

### columns

> `readonly` **columns**: `number`

Defined in: [api.ts:342](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L342)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [api.ts:345](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L345)

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [api.ts:346](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L346)

***

### revision

> `readonly` **revision**: `number`

Defined in: [api.ts:341](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L341)

***

### rows

> `readonly` **rows**: `number`

Defined in: [api.ts:343](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L343)

## Methods

### ansi()

> **ansi**(): `string`

Defined in: [api.ts:352](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L352)

ANSI-styled serialization of the visible grid (addon-serialize).

#### Returns

`string`

***

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [api.ts:350](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L350)

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

Defined in: [api.ts:353](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L353)

#### Returns

`string`

***

### line()

> **line**(`row`): `string`

Defined in: [api.ts:349](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L349)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [api.ts:348](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L348)

Visible grid text, one string per row (trailing whitespace trimmed).

#### Returns

`string`
