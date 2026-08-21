---
title: "Interface: ErrorDiagnostics"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ErrorDiagnostics

# Interface: ErrorDiagnostics

Defined in: [driver/src/api.ts:923](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L923)

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

Defined in: [driver/src/api.ts:926](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L926)

***

### screenExcerpt?

> `readonly` `optional` **screenExcerpt?**: `string`

Defined in: [driver/src/api.ts:924](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L924)

***

### semanticTree

> `readonly` **semanticTree**: `boolean`

Defined in: [driver/src/api.ts:925](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L925)

***

### suggestion?

> `readonly` `optional` **suggestion?**: `string`

Defined in: [driver/src/api.ts:927](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L927)
