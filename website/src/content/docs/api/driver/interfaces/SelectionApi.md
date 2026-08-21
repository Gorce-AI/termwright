---
title: "Interface: SelectionApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SelectionApi

# Interface: SelectionApi

Defined in: [driver/src/api.ts:433](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L433)

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

Defined in: [driver/src/api.ts:436](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L436)

#### Returns

`void`

***

### copy()

> **copy**(): `string`

Defined in: [driver/src/api.ts:435](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L435)

#### Returns

`string`

***

### selectCells()

> **selectCells**(`range`): `void`

Defined in: [driver/src/api.ts:434](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L434)

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
