---
title: "Interface: SessionEventSubscriptionOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventSubscriptionOptions

# Interface: SessionEventSubscriptionOptions

Defined in: [driver/src/api.ts:813](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L813)

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

Defined in: [driver/src/api.ts:815](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L815)

Inclusive source sequence. Use `1` to observe the complete startup.

***

### onError?

> `readonly` `optional` **onError?**: (`error`, `record`) => `void`

Defined in: [driver/src/api.ts:827](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L827)

Reports a delivery this subscriber rejected, for sinks that must not lose
a record.

Without it a listener that throws is downgraded to a session diagnostic
and the record is simply gone — fine for a projection that can be redrawn,
wrong for a durable sink, where the loss stays invisible until something
far away notices the hole. A subscriber that owns evidence should pass
this and fail its own operation.

#### Parameters

##### error

`unknown`

##### record

[`SessionEventRecord`](../../type-aliases/sessioneventrecord/)

#### Returns

`void`

***

### onGap?

> `readonly` `optional` **onGap?**: (`gap`) => `void`

Defined in: [driver/src/api.ts:816](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L816)

#### Parameters

##### gap

[`SessionEventGap`](../sessioneventgap/)

#### Returns

`void`
