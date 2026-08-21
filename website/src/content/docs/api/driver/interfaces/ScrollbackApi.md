---
title: "Interface: ScrollbackApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScrollbackApi

# Interface: ScrollbackApi

Defined in: [driver/src/api.ts:424](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L424)

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

### length

> `readonly` **length**: `number`

Defined in: [driver/src/api.ts:425](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L425)

***

### retainedFloor

> `readonly` **retainedFloor**: `number`

Defined in: [driver/src/api.ts:426](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L426)

## Methods

### move()

> **move**(`opts`): `void`

Defined in: [driver/src/api.ts:427](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L427)

#### Parameters

##### opts

###### lines

`number`

#### Returns

`void`

***

### position()

> **position**(): `number`

Defined in: [driver/src/api.ts:428](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L428)

#### Returns

`number`

***

### search()

> **search**(`text`): readonly `object`[]

Defined in: [driver/src/api.ts:430](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L430)

#### Parameters

##### text

`string` \| `RegExp`

#### Returns

readonly `object`[]

***

### text()

> **text**(`opts?`): `string`

Defined in: [driver/src/api.ts:429](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L429)

#### Parameters

##### opts?

###### from?

`number`

###### to?

`number`

#### Returns

`string`
