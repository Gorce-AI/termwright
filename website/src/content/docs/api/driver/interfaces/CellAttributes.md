---
title: "Interface: CellAttributes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellAttributes

# Interface: CellAttributes

Defined in: [driver/src/api.ts:448](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L448)

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

Defined in: [driver/src/api.ts:449](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L449)

***

### dim

> `readonly` **dim**: `boolean`

Defined in: [driver/src/api.ts:450](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L450)

***

### inverse

> `readonly` **inverse**: `boolean`

Defined in: [driver/src/api.ts:453](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L453)

***

### italic

> `readonly` **italic**: `boolean`

Defined in: [driver/src/api.ts:451](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L451)

***

### strikethrough

> `readonly` **strikethrough**: `boolean`

Defined in: [driver/src/api.ts:454](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L454)

***

### underline

> `readonly` **underline**: `boolean`

Defined in: [driver/src/api.ts:452](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L452)
