---
title: "Interface: CellAttributes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellAttributes

# Interface: CellAttributes

Defined in: [driver/src/api.ts:423](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L423)

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

### bold

> `readonly` **bold**: `boolean`

Defined in: [driver/src/api.ts:424](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L424)

***

### dim

> `readonly` **dim**: `boolean`

Defined in: [driver/src/api.ts:425](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L425)

***

### inverse

> `readonly` **inverse**: `boolean`

Defined in: [driver/src/api.ts:428](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L428)

***

### italic

> `readonly` **italic**: `boolean`

Defined in: [driver/src/api.ts:426](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L426)

***

### strikethrough

> `readonly` **strikethrough**: `boolean`

Defined in: [driver/src/api.ts:429](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L429)

***

### underline

> `readonly` **underline**: `boolean`

Defined in: [driver/src/api.ts:427](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L427)
