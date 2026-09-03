---
title: "Interface: ScreenSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenSnapshot

# Interface: ScreenSnapshot

Defined in: [driver/src/api.ts:496](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L496)

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

Defined in: [driver/src/api.ts:500](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L500)

***

### columns

> `readonly` **columns**: `number`

Defined in: [driver/src/api.ts:498](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L498)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:501](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L501)

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:502](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L502)

***

### revision

> `readonly` **revision**: `number`

Defined in: [driver/src/api.ts:497](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L497)

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:499](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L499)

## Methods

### ansi()

> **ansi**(): `string`

Defined in: [driver/src/api.ts:508](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L508)

ANSI-styled serialization of the visible grid (addon-serialize).

#### Returns

`string`

***

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:506](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L506)

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

Defined in: [driver/src/api.ts:509](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L509)

#### Returns

`string`

***

### line()

> **line**(`row`): `string`

Defined in: [driver/src/api.ts:505](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L505)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:504](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L504)

Visible grid text, one string per row (trailing whitespace trimmed).

#### Returns

`string`
