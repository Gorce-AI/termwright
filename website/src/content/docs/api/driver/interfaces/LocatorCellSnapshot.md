---
title: "Interface: LocatorCellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshot

# Interface: LocatorCellSnapshot

Defined in: [api.ts:447](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L447)

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

### columns

> `readonly` **columns**: `number`

Defined in: [api.ts:450](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L450)

***

### origin

> `readonly` **origin**: `object`

Defined in: [api.ts:449](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L449)

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### rows

> `readonly` **rows**: `number`

Defined in: [api.ts:451](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L451)

***

### stamp

> `readonly` **stamp**: `ObservationStamp`

Defined in: [api.ts:448](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L448)

## Methods

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [api.ts:454](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L454)

#### Parameters

##### row

`number`

##### column

`number`

#### Returns

[`CellSnapshot`](../cellsnapshot/)

***

### line()

> **line**(`row`): `string`

Defined in: [api.ts:453](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L453)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [api.ts:452](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L452)

#### Returns

`string`
