---
title: "Interface: LocatorCellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshot

# Interface: LocatorCellSnapshot

Defined in: [driver/src/api.ts:780](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L780)

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

Defined in: [driver/src/api.ts:783](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L783)

***

### origin

> `readonly` **origin**: `object`

Defined in: [driver/src/api.ts:782](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L782)

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:784](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L784)

***

### stamp

> `readonly` **stamp**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:781](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L781)

## Methods

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:787](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L787)

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

Defined in: [driver/src/api.ts:786](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L786)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:785](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L785)

#### Returns

`string`
