---
title: "Interface: CellAttributes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellAttributes

# Interface: CellAttributes

Defined in: [driver/src/api.ts:430](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L430)

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

Defined in: [driver/src/api.ts:431](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L431)

***

### dim

> `readonly` **dim**: `boolean`

Defined in: [driver/src/api.ts:432](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L432)

***

### inverse

> `readonly` **inverse**: `boolean`

Defined in: [driver/src/api.ts:435](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L435)

***

### italic

> `readonly` **italic**: `boolean`

Defined in: [driver/src/api.ts:433](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L433)

***

### strikethrough

> `readonly` **strikethrough**: `boolean`

Defined in: [driver/src/api.ts:436](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L436)

***

### underline

> `readonly` **underline**: `boolean`

Defined in: [driver/src/api.ts:434](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L434)
