---
title: "Interface: SessionEventSubscriptionOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventSubscriptionOptions

# Interface: SessionEventSubscriptionOptions

Defined in: [driver/src/api.ts:847](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L847)

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

### fromSequence

> `readonly` **fromSequence**: `number`

Defined in: [driver/src/api.ts:849](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L849)

Inclusive source sequence. Use `1` to observe the complete startup.

***

### onGap?

> `readonly` `optional` **onGap?**: (`gap`) => `void`

Defined in: [driver/src/api.ts:850](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L850)

#### Parameters

##### gap

[`SessionEventGap`](../sessioneventgap/)

#### Returns

`void`
