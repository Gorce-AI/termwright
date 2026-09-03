---
title: "Interface: Mouse"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Mouse

# Interface: Mouse

Defined in: [driver/src/api.ts:310](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L310)

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

## Methods

### click()

> **click**(`point`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:318](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L318)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### down()

> **down**(`point`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:312](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L312)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### drag()

> **drag**(`options`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:332](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L332)

#### Parameters

##### options

[`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### move()

> **move**(`point`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:311](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L311)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/)

#### Returns

`Promise`\<`void`\>

***

### up()

> **up**(`point`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:315](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L315)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### wheel()

> **wheel**(`options`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:325](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L325)

#### Parameters

##### options

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>
