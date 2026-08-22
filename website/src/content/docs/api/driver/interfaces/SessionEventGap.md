---
title: "Interface: SessionEventGap"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SessionEventGap

# Interface: SessionEventGap

Defined in: [driver/src/api.ts:853](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L853)

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

Defined in: [driver/src/api.ts:855](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L855)

***

### lastLostSequence

> `readonly` **lastLostSequence**: `number`

Defined in: [driver/src/api.ts:856](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L856)

***

### lostBytes

> `readonly` **lostBytes**: `number`

Defined in: [driver/src/api.ts:858](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L858)

***

### lostEvents

> `readonly` **lostEvents**: `number`

Defined in: [driver/src/api.ts:857](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L857)

***

### requestedSequence

> `readonly` **requestedSequence**: `number`

Defined in: [driver/src/api.ts:854](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L854)
