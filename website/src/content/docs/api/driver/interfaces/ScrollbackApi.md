---
title: "Interface: ScrollbackApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScrollbackApi

# Interface: ScrollbackApi

Defined in: [driver/src/api.ts:429](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L429)

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

Defined in: [driver/src/api.ts:430](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L430)

***

### retainedFloor

> `readonly` **retainedFloor**: `number`

Defined in: [driver/src/api.ts:431](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L431)

## Methods

### move()

> **move**(`opts`): `void`

Defined in: [driver/src/api.ts:432](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L432)

#### Parameters

##### opts

###### lines

`number`

#### Returns

`void`

***

### position()

> **position**(): `number`

Defined in: [driver/src/api.ts:433](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L433)

#### Returns

`number`

***

### search()

> **search**(`text`): readonly `object`[]

Defined in: [driver/src/api.ts:435](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L435)

#### Parameters

##### text

`string` \| `RegExp`

#### Returns

readonly `object`[]

***

### text()

> **text**(`opts?`): `string`

Defined in: [driver/src/api.ts:434](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L434)

#### Parameters

##### opts?

###### from?

`number`

###### to?

`number`

#### Returns

`string`
