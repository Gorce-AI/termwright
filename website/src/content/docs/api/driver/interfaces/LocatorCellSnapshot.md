---
title: "Interface: LocatorCellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshot

# Interface: LocatorCellSnapshot

Defined in: [driver/src/api.ts:559](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L559)

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

Defined in: [driver/src/api.ts:562](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L562)

***

### origin

> `readonly` **origin**: `object`

Defined in: [driver/src/api.ts:561](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L561)

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:563](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L563)

***

### stamp

> `readonly` **stamp**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:560](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L560)

## Methods

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:566](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L566)

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

Defined in: [driver/src/api.ts:565](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L565)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:564](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L564)

#### Returns

`string`
