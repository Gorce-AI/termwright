---
title: "Interface: LocatorCellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshot

# Interface: LocatorCellSnapshot

Defined in: [driver/src/api.ts:743](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L743)

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

Defined in: [driver/src/api.ts:746](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L746)

***

### origin

> `readonly` **origin**: `object`

Defined in: [driver/src/api.ts:745](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L745)

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:747](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L747)

***

### stamp

> `readonly` **stamp**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:744](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L744)

## Methods

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:750](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L750)

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

Defined in: [driver/src/api.ts:749](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L749)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:748](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L748)

#### Returns

`string`
