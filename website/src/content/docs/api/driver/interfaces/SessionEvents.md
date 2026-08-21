---
title: "Interface: SessionEvents"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEvents

# Interface: SessionEvents

Defined in: [driver/src/api.ts:645](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L645)

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

## Methods

### on()

> **on**\<`E`\>(`event`, `cb`): () => `void`

Defined in: [driver/src/api.ts:646](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L646)

#### Type Parameters

##### E

`E` *extends* keyof [`SessionEventMap`](../sessioneventmap/)

#### Parameters

##### event

`E`

##### cb

(`payload`) => `void`

#### Returns

() => `void`
