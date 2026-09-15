---
title: "Interface: ScreenSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenSnapshot

# Interface: ScreenSnapshot

Defined in: [driver/src/api.ts:533](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L533)

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

Defined in: [driver/src/api.ts:537](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L537)

***

### columns

> `readonly` **columns**: `number`

Defined in: [driver/src/api.ts:535](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L535)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:538](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L538)

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:539](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L539)

***

### revision

> `readonly` **revision**: `number`

Defined in: [driver/src/api.ts:534](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L534)

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:536](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L536)

## Methods

### ansi()

> **ansi**(): `string`

Defined in: [driver/src/api.ts:545](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L545)

ANSI-styled serialization of the visible grid (addon-serialize).

#### Returns

`string`

***

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:543](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L543)

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

Defined in: [driver/src/api.ts:546](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L546)

#### Returns

`string`

***

### line()

> **line**(`row`): `string`

Defined in: [driver/src/api.ts:542](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L542)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:541](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L541)

Visible grid text, one string per row (trailing whitespace trimmed).

#### Returns

`string`
