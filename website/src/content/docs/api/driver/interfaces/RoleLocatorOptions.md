---
title: "Interface: RoleLocatorOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / RoleLocatorOptions

# Interface: RoleLocatorOptions

Defined in: [api.ts:374](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L374)

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

Defined in: [api.ts:376](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L376)

***

### frameworkType?

> `readonly` `optional` **frameworkType?**: `string` \| `RegExp`

Defined in: [api.ts:386](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L386)

Narrows to nodes whose framework type matches, e.g.
`getByRole('generic', { frameworkType: 'ScrollView' })`.

Without it `generic` is barely selectable: every widget a recognizer did
not know arrives under that one role, and the role alone cannot tell them
apart.

***

### name?

> `readonly` `optional` **name?**: `string` \| `RegExp`

Defined in: [api.ts:375](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L375)

***

### state?

> `readonly` `optional` **state?**: `Partial`\<`SemanticState`\>

Defined in: [api.ts:377](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L377)
