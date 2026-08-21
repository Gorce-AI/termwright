---
title: "Interface: RoleLocatorOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / RoleLocatorOptions

# Interface: RoleLocatorOptions

Defined in: [driver/src/api.ts:442](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L442)

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

Defined in: [driver/src/api.ts:444](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L444)

***

### frameworkType?

> `readonly` `optional` **frameworkType?**: `string` \| `RegExp`

Defined in: [driver/src/api.ts:454](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L454)

Narrows to nodes whose framework type matches, e.g.
`getByRole('generic', { frameworkType: 'ScrollView' })`.

Without it `generic` is barely selectable: every widget a recognizer did
not know arrives under that one role, and the role alone cannot tell them
apart.

***

### name?

> `readonly` `optional` **name?**: `string` \| `RegExp`

Defined in: [driver/src/api.ts:443](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L443)

***

### state?

> `readonly` `optional` **state?**: `Partial`\<`SemanticState`\>

Defined in: [driver/src/api.ts:445](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L445)
