---
title: "Interface: CellAttributes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellAttributes

# Interface: CellAttributes

Defined in: [driver/src/api.ts:363](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L363)

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

Defined in: [driver/src/api.ts:364](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L364)

***

### dim

> `readonly` **dim**: `boolean`

Defined in: [driver/src/api.ts:365](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L365)

***

### inverse

> `readonly` **inverse**: `boolean`

Defined in: [driver/src/api.ts:368](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L368)

***

### italic

> `readonly` **italic**: `boolean`

Defined in: [driver/src/api.ts:366](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L366)

***

### strikethrough

> `readonly` **strikethrough**: `boolean`

Defined in: [driver/src/api.ts:369](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L369)

***

### underline

> `readonly` **underline**: `boolean`

Defined in: [driver/src/api.ts:367](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L367)
