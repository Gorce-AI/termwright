---
title: "Interface: ScreenSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenSnapshot

# Interface: ScreenSnapshot

Defined in: [driver/src/api.ts:478](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L478)

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

Defined in: [driver/src/api.ts:482](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L482)

***

### columns

> `readonly` **columns**: `number`

Defined in: [driver/src/api.ts:480](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L480)

***

### cursor

> `readonly` **cursor**: `CursorInfo`

Defined in: [driver/src/api.ts:483](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L483)

***

### modes

> `readonly` **modes**: [`TerminalModes`](../terminalmodes/)

Defined in: [driver/src/api.ts:484](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L484)

***

### revision

> `readonly` **revision**: `number`

Defined in: [driver/src/api.ts:479](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L479)

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:481](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L481)

## Methods

### ansi()

> **ansi**(): `string`

Defined in: [driver/src/api.ts:490](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L490)

ANSI-styled serialization of the visible grid (addon-serialize).

#### Returns

`string`

***

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:488](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L488)

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

Defined in: [driver/src/api.ts:491](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L491)

#### Returns

`string`

***

### line()

> **line**(`row`): `string`

Defined in: [driver/src/api.ts:487](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L487)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:486](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L486)

Visible grid text, one string per row (trailing whitespace trimmed).

#### Returns

`string`
