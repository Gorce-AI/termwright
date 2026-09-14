---
title: "Interface: CellAttributes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellAttributes

# Interface: CellAttributes

Defined in: [driver/src/api.ts:483](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L483)

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

Defined in: [driver/src/api.ts:484](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L484)

***

### dim

> `readonly` **dim**: `boolean`

Defined in: [driver/src/api.ts:485](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L485)

***

### inverse

> `readonly` **inverse**: `boolean`

Defined in: [driver/src/api.ts:488](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L488)

***

### italic

> `readonly` **italic**: `boolean`

Defined in: [driver/src/api.ts:486](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L486)

***

### strikethrough

> `readonly` **strikethrough**: `boolean`

Defined in: [driver/src/api.ts:489](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L489)

***

### underline

> `readonly` **underline**: `boolean`

Defined in: [driver/src/api.ts:487](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L487)
