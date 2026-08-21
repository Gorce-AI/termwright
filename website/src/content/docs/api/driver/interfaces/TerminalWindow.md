---
title: "Interface: TerminalWindow"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalWindow

# Interface: TerminalWindow

Defined in: [driver/src/api.ts:253](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L253)

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

## Methods

### blur()

> **blur**(): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:255](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L255)

#### Returns

`Promise`\<`void`\>

***

### focus()

> **focus**(): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:254](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L254)

#### Returns

`Promise`\<`void`\>
