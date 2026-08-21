---
title: "Interface: SpatialRelationExpectation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / SpatialRelationExpectation

# Interface: SpatialRelationExpectation

Defined in: [driver/src/api.ts:589](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L589)

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

Defined in: [driver/src/api.ts:590](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L590)

***

### target

> `readonly` **target**: [`Locator`](../locator/)

Defined in: [driver/src/api.ts:591](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L591)
