---
title: "Interface: TextLocatorOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TextLocatorOptions

# Interface: TextLocatorOptions

Defined in: [driver/src/api.ts:548](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L548)

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

## Extended by

- [`ScreenTextLocatorOptions`](../screentextlocatoroptions/)

## Properties

### exact?

> `readonly` `optional` **exact?**: `boolean`

Defined in: [driver/src/api.ts:549](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L549)
