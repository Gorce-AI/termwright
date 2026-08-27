---
title: "Interface: LocatorCellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshot

# Interface: LocatorCellSnapshot

Defined in: [driver/src/api.ts:703](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L703)

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

Defined in: [driver/src/api.ts:706](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L706)

***

### origin

> `readonly` **origin**: `object`

Defined in: [driver/src/api.ts:705](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L705)

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:707](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L707)

***

### stamp

> `readonly` **stamp**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:704](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L704)

## Methods

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:710](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L710)

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

Defined in: [driver/src/api.ts:709](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L709)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:708](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L708)

#### Returns

`string`
