---
title: "Interface: ErrorDiagnostics"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ErrorDiagnostics

# Interface: ErrorDiagnostics

Defined in: [api.ts:797](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L797)

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

### candidates?

> `readonly` `optional` **candidates?**: readonly [`ResolvedTarget`](../resolvedtarget/)[]

Defined in: [api.ts:800](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L800)

***

### screenExcerpt?

> `readonly` `optional` **screenExcerpt?**: `string`

Defined in: [api.ts:798](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L798)

***

### semanticTree

> `readonly` **semanticTree**: `boolean`

Defined in: [api.ts:799](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L799)

***

### suggestion?

> `readonly` `optional` **suggestion?**: `string`

Defined in: [api.ts:801](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L801)
