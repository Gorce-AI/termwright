---
title: "Interface: LocatorFilterOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorFilterOptions

# Interface: LocatorFilterOptions

Defined in: [driver/src/api.ts:553](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L553)

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

### has?

> `readonly` `optional` **has?**: [`Locator`](../locator/)

Defined in: [driver/src/api.ts:555](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L555)

***

### hasNot?

> `readonly` `optional` **hasNot?**: [`Locator`](../locator/)

Defined in: [driver/src/api.ts:556](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L556)

***

### hasText?

> `readonly` `optional` **hasText?**: `string` \| `RegExp`

Defined in: [driver/src/api.ts:554](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L554)
