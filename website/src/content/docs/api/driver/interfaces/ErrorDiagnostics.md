---
title: "Interface: ErrorDiagnostics"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ErrorDiagnostics

# Interface: ErrorDiagnostics

Defined in: [driver/src/api.ts:1171](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1171)

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

Defined in: [driver/src/api.ts:1174](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1174)

***

### screenExcerpt?

> `readonly` `optional` **screenExcerpt?**: `string`

Defined in: [driver/src/api.ts:1172](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1172)

***

### semanticTree

> `readonly` **semanticTree**: `boolean`

Defined in: [driver/src/api.ts:1173](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1173)

***

### suggestion?

> `readonly` `optional` **suggestion?**: `string`

Defined in: [driver/src/api.ts:1175](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1175)
