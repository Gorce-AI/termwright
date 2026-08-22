---
title: "Interface: LocatorCellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshot

# Interface: LocatorCellSnapshot

Defined in: [driver/src/api.ts:737](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L737)

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

Defined in: [driver/src/api.ts:740](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L740)

***

### origin

> `readonly` **origin**: `object`

Defined in: [driver/src/api.ts:739](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L739)

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:741](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L741)

***

### stamp

> `readonly` **stamp**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:738](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L738)

## Methods

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:744](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L744)

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

Defined in: [driver/src/api.ts:743](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L743)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:742](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L742)

#### Returns

`string`
