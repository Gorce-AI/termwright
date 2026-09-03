---
title: "Interface: ScrollbackApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScrollbackApi

# Interface: ScrollbackApi

Defined in: [driver/src/api.ts:512](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L512)

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

Defined in: [driver/src/api.ts:513](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L513)

***

### retainedFloor

> `readonly` **retainedFloor**: `number`

Defined in: [driver/src/api.ts:514](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L514)

## Methods

### move()

> **move**(`opts`): `void`

Defined in: [driver/src/api.ts:515](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L515)

#### Parameters

##### opts

###### lines

`number`

#### Returns

`void`

***

### position()

> **position**(): `number`

Defined in: [driver/src/api.ts:516](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L516)

#### Returns

`number`

***

### search()

> **search**(`text`): readonly `object`[]

Defined in: [driver/src/api.ts:518](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L518)

#### Parameters

##### text

`string` \| `RegExp`

#### Returns

readonly `object`[]

***

### text()

> **text**(`opts?`): `string`

Defined in: [driver/src/api.ts:517](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L517)

#### Parameters

##### opts?

###### from?

`number`

###### to?

`number`

#### Returns

`string`
