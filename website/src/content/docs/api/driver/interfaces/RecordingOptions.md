---
title: "Interface: RecordingOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / RecordingOptions

# Interface: RecordingOptions

Defined in: [driver/src/api.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L42)

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

### enabled?

> `readonly` `optional` **enabled?**: `boolean`

Defined in: [driver/src/api.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L44)

Recording of the raw session to asciicast is ON by default.

***

### idleTimeLimit?

> `readonly` `optional` **idleTimeLimit?**: `number`

Defined in: [driver/src/api.ts:45](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L45)
