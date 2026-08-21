---
title: "Interface: ScrollbackApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScrollbackApi

# Interface: ScrollbackApi

Defined in: [api.ts:356](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L356)

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

Defined in: [api.ts:357](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L357)

***

### retainedFloor

> `readonly` **retainedFloor**: `number`

Defined in: [api.ts:358](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L358)

## Methods

### move()

> **move**(`opts`): `void`

Defined in: [api.ts:359](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L359)

#### Parameters

##### opts

###### lines

`number`

#### Returns

`void`

***

### position()

> **position**(): `number`

Defined in: [api.ts:360](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L360)

#### Returns

`number`

***

### search()

> **search**(`text`): readonly `object`[]

Defined in: [api.ts:362](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L362)

#### Parameters

##### text

`string` \| `RegExp`

#### Returns

readonly `object`[]

***

### text()

> **text**(`opts?`): `string`

Defined in: [api.ts:361](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L361)

#### Parameters

##### opts?

###### from?

`number`

###### to?

`number`

#### Returns

`string`
