---
title: "Interface: Keyboard"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Keyboard

# Interface: Keyboard

Defined in: [driver/src/api.ts:232](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L232)

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

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:235](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L235)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:233](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L233)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:234](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L234)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>
