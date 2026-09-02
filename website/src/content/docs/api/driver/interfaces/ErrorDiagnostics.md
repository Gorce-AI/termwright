---
title: "Interface: ErrorDiagnostics"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ErrorDiagnostics

# Interface: ErrorDiagnostics

Defined in: [driver/src/api.ts:1151](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1151)

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

> `readonly` `optional` **candidates?**: readonly [`ResolvedTarget`](../resolvedtarget/)\<[`LocatorDomain`](../../type-aliases/locatordomain/)\>[]

Defined in: [driver/src/api.ts:1154](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1154)

***

### screenExcerpt?

> `readonly` `optional` **screenExcerpt?**: `string`

Defined in: [driver/src/api.ts:1152](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1152)

***

### semanticTree

> `readonly` **semanticTree**: `boolean`

Defined in: [driver/src/api.ts:1153](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1153)

***

### suggestion?

> `readonly` `optional` **suggestion?**: `string`

Defined in: [driver/src/api.ts:1155](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1155)
