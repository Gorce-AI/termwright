---
title: "Interface: LocatorCellSnapshot"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorCellSnapshot

# Interface: LocatorCellSnapshot

Defined in: [driver/src/api.ts:774](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L774)

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

Defined in: [driver/src/api.ts:777](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L777)

***

### origin

> `readonly` **origin**: `object`

Defined in: [driver/src/api.ts:776](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L776)

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### rows

> `readonly` **rows**: `number`

Defined in: [driver/src/api.ts:778](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L778)

***

### stamp

> `readonly` **stamp**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:775](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L775)

## Methods

### cell()

> **cell**(`row`, `column`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:781](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L781)

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

Defined in: [driver/src/api.ts:780](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L780)

#### Parameters

##### row

`number`

#### Returns

`string`

***

### text()

> **text**(): `string`

Defined in: [driver/src/api.ts:779](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L779)

#### Returns

`string`
