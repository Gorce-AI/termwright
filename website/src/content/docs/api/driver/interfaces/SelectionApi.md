---
title: "Interface: SelectionApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SelectionApi

# Interface: SelectionApi

Defined in: [api.ts:365](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L365)

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

### clear()

> **clear**(): `void`

Defined in: [api.ts:368](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L368)

#### Returns

`void`

***

### copy()

> **copy**(): `string`

Defined in: [api.ts:367](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L367)

#### Returns

`string`

***

### selectCells()

> **selectCells**(`range`): `void`

Defined in: [api.ts:366](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L366)

#### Parameters

##### range

###### end

\{ `column`: `number`; `row`: `number`; \}

###### end.column

`number`

###### end.row

`number`

###### start

\{ `column`: `number`; `row`: `number`; \}

###### start.column

`number`

###### start.row

`number`

#### Returns

`void`
