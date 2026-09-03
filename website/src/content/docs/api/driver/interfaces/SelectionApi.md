---
title: "Interface: SelectionApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SelectionApi

# Interface: SelectionApi

Defined in: [driver/src/api.ts:521](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L521)

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

Defined in: [driver/src/api.ts:527](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L527)

#### Returns

`void`

***

### copy()

> **copy**(): `string`

Defined in: [driver/src/api.ts:526](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L526)

#### Returns

`string`

***

### selectCells()

> **selectCells**(`range`): `void`

Defined in: [driver/src/api.ts:522](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L522)

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
