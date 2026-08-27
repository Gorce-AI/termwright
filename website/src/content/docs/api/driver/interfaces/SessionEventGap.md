---
title: "Interface: SessionEventGap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventGap

# Interface: SessionEventGap

Defined in: [driver/src/api.ts:870](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L870)

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

### firstAvailableSequence

> `readonly` **firstAvailableSequence**: `number`

Defined in: [driver/src/api.ts:872](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L872)

***

### lastLostSequence

> `readonly` **lastLostSequence**: `number`

Defined in: [driver/src/api.ts:873](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L873)

***

### lostBytes

> `readonly` **lostBytes**: `number`

Defined in: [driver/src/api.ts:875](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L875)

***

### lostEvents

> `readonly` **lostEvents**: `number`

Defined in: [driver/src/api.ts:874](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L874)

***

### requestedSequence

> `readonly` **requestedSequence**: `number`

Defined in: [driver/src/api.ts:871](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L871)
