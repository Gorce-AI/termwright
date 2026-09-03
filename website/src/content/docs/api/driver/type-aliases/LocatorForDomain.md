---
title: "Type Alias: LocatorForDomain"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / LocatorForDomain

# Type Alias: LocatorForDomain\<D\>

> **LocatorForDomain**\<`D`\> = `D` *extends* `"semantic"` ? [`SemanticLocator`](../../interfaces/semanticlocator/) : [`ScreenLocator`](../../interfaces/screenlocator/)

Defined in: [driver/src/api.ts:702](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L702)

`@termwright/driver` — PTY + VT sessions, locators, actions and waits.

The normative public API lives in `api.ts`; this module is the only entry
point and re-exports the types from there together with their runtime
implementations.

## Type Parameters

### D

`D` *extends* [`LocatorDomain`](../locatordomain/)

## Example

```ts
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', 'app.js'] });
await terminal.waitForText('Ready');
await terminal.getByRole('button', { name: 'Approve' }).activate();
await terminal.close();
```
