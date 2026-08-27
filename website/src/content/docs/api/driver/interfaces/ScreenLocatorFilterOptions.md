---
title: "Interface: ScreenLocatorFilterOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ScreenLocatorFilterOptions

# Interface: ScreenLocatorFilterOptions

Defined in: [driver/src/api.ts:725](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L725)

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

> `readonly` `optional` **has?**: [`ScreenLocator`](../screenlocator/)

Defined in: [driver/src/api.ts:727](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L727)

***

### hasNot?

> `readonly` `optional` **hasNot?**: [`ScreenLocator`](../screenlocator/)

Defined in: [driver/src/api.ts:728](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L728)

***

### hasText?

> `readonly` `optional` **hasText?**: `string` \| `RegExp`

Defined in: [driver/src/api.ts:726](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L726)
