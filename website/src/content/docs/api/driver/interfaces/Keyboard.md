---
title: "Interface: Keyboard"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Keyboard

# Interface: Keyboard

Defined in: [driver/src/api.ts:227](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L227)

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

Defined in: [driver/src/api.ts:230](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L230)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:228](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L228)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:229](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L229)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>
