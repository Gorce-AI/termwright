---
title: "Interface: SessionEventGap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventGap

# Interface: SessionEventGap

Defined in: [driver/src/api.ts:859](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L859)

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

Defined in: [driver/src/api.ts:861](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L861)

***

### lastLostSequence

> `readonly` **lastLostSequence**: `number`

Defined in: [driver/src/api.ts:862](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L862)

***

### lostBytes

> `readonly` **lostBytes**: `number`

Defined in: [driver/src/api.ts:864](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L864)

***

### lostEvents

> `readonly` **lostEvents**: `number`

Defined in: [driver/src/api.ts:863](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L863)

***

### requestedSequence

> `readonly` **requestedSequence**: `number`

Defined in: [driver/src/api.ts:860](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L860)
