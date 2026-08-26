---
title: "Interface: SemanticLocatorFilterOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SemanticLocatorFilterOptions

# Interface: SemanticLocatorFilterOptions

Defined in: [driver/src/api.ts:712](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L712)

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

> `readonly` `optional` **has?**: [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:714](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L714)

***

### hasNot?

> `readonly` `optional` **hasNot?**: [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:715](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L715)

***

### hasText?

> `readonly` `optional` **hasText?**: `string` \| `RegExp`

Defined in: [driver/src/api.ts:713](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L713)
