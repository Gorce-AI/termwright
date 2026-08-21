---
title: "Interface: Mouse"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Mouse

# Interface: Mouse

Defined in: [driver/src/api.ts:244](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L244)

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

Defined in: [driver/src/api.ts:248](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L248)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### down()

> **down**(`point`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:246](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L246)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### drag()

> **drag**(`options`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:250](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L250)

#### Parameters

##### options

[`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### move()

> **move**(`point`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:245](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L245)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/)

#### Returns

`Promise`\<`void`\>

***

### up()

> **up**(`point`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:247](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L247)

#### Parameters

##### point

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>

***

### wheel()

> **wheel**(`options`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:249](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L249)

#### Parameters

##### options

[`MousePoint`](../mousepoint/) & [`MouseModifierOptions`](../mousemodifieroptions/) & `object`

#### Returns

`Promise`\<`void`\>
