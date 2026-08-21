---
title: "Interface: TerminalWindow"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalWindow

# Interface: TerminalWindow

Defined in: [driver/src/api.ts:258](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L258)

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

Defined in: [driver/src/api.ts:260](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L260)

#### Returns

`Promise`\<`void`\>

***

### focus()

> **focus**(): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:259](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L259)

#### Returns

`Promise`\<`void`\>
