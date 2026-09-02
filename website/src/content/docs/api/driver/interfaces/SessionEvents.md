---
title: "Interface: SessionEvents"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEvents

# Interface: SessionEvents

Defined in: [driver/src/api.ts:796](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L796)

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

### checkpoint()

> **checkpoint**(): `number`

Defined in: [driver/src/api.ts:803](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L803)

Last sequence assigned by the source journal. Zero means no event yet.

#### Returns

`number`

***

### on()

> **on**\<`E`\>(`event`, `cb`): () => `void`

Defined in: [driver/src/api.ts:797](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L797)

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

***

### subscribe()

> **subscribe**(`options`, `cb`): () => `void`

Defined in: [driver/src/api.ts:811](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L811)

Subscribes to the single ordered session stream and replays retained
events starting at `fromSequence` before switching to live delivery.
A requested prefix that exceeded the bounded journal is never hidden:
`onGap` runs first, or subscription throws when no gap handler is given.

#### Parameters

##### options

[`SessionEventSubscriptionOptions`](../sessioneventsubscriptionoptions/)

##### cb

(`event`) => `void`

#### Returns

() => `void`
