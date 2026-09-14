---
title: "Interface: ShellRunOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellRunOptions

# Interface: ShellRunOptions

Defined in: [driver/src/api.ts:413](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L413)

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

## Extends

- [`WaitOptions`](../waitoptions/)

## Properties

### maxOutputBytes?

> `readonly` `optional` **maxOutputBytes?**: `number`

Defined in: [driver/src/api.ts:415](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L415)

Maximum captured bytes between OSC 133 C and D. Defaults to 8 MiB.

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:598](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L598)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)
