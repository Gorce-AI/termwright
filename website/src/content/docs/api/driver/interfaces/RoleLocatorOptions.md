---
title: "Interface: RoleLocatorOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / RoleLocatorOptions

# Interface: RoleLocatorOptions

Defined in: [driver/src/api.ts:509](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L509)

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

### exact?

> `readonly` `optional` **exact?**: `boolean`

Defined in: [driver/src/api.ts:511](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L511)

***

### frameworkType?

> `readonly` `optional` **frameworkType?**: `string` \| `RegExp`

Defined in: [driver/src/api.ts:521](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L521)

Narrows to nodes whose framework type matches, e.g.
`getByRole('generic', { frameworkType: 'ScrollView' })`.

Without it `generic` is barely selectable: every widget a recognizer did
not know arrives under that one role, and the role alone cannot tell them
apart.

***

### name?

> `readonly` `optional` **name?**: `string` \| `RegExp`

Defined in: [driver/src/api.ts:510](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L510)

***

### state?

> `readonly` `optional` **state?**: `Partial`\<`SemanticState`\>

Defined in: [driver/src/api.ts:512](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L512)
