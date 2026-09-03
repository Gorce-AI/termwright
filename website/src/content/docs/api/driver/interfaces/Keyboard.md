---
title: "Interface: Keyboard"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Keyboard

# Interface: Keyboard

Defined in: [driver/src/api.ts:293](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L293)

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

Defined in: [driver/src/api.ts:296](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L296)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:294](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L294)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:295](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L295)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

#### Returns

`Promise`\<`void`\>
