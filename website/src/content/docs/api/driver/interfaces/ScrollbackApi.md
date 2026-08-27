---
title: "Interface: ScrollbackApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScrollbackApi

# Interface: ScrollbackApi

Defined in: [driver/src/api.ts:494](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L494)

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

Defined in: [driver/src/api.ts:495](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L495)

***

### retainedFloor

> `readonly` **retainedFloor**: `number`

Defined in: [driver/src/api.ts:496](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L496)

## Methods

### move()

> **move**(`opts`): `void`

Defined in: [driver/src/api.ts:497](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L497)

#### Parameters

##### opts

###### lines

`number`

#### Returns

`void`

***

### position()

> **position**(): `number`

Defined in: [driver/src/api.ts:498](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L498)

#### Returns

`number`

***

### search()

> **search**(`text`): readonly `object`[]

Defined in: [driver/src/api.ts:500](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L500)

#### Parameters

##### text

`string` \| `RegExp`

#### Returns

readonly `object`[]

***

### text()

> **text**(`opts?`): `string`

Defined in: [driver/src/api.ts:499](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L499)

#### Parameters

##### opts?

###### from?

`number`

###### to?

`number`

#### Returns

`string`
