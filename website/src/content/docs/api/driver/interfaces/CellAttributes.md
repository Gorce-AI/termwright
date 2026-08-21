---
title: "Interface: CellAttributes"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CellAttributes

# Interface: CellAttributes

Defined in: [api.ts:296](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L296)

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

Defined in: [api.ts:297](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L297)

***

### dim

> `readonly` **dim**: `boolean`

Defined in: [api.ts:298](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L298)

***

### inverse

> `readonly` **inverse**: `boolean`

Defined in: [api.ts:301](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L301)

***

### italic

> `readonly` **italic**: `boolean`

Defined in: [api.ts:299](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L299)

***

### strikethrough

> `readonly` **strikethrough**: `boolean`

Defined in: [api.ts:302](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L302)

***

### underline

> `readonly` **underline**: `boolean`

Defined in: [api.ts:300](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L300)
