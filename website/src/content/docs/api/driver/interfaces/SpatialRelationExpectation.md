---
title: "Interface: SpatialRelationExpectation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SpatialRelationExpectation

# Interface: SpatialRelationExpectation

Defined in: [driver/src/api.ts:730](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L730)

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

### relation

> `readonly` **relation**: `SpatialRelation`

Defined in: [driver/src/api.ts:731](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L731)

***

### target

> `readonly` **target**: [`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

Defined in: [driver/src/api.ts:732](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L732)
