---
title: "Interface: ShellApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellApi

# Interface: ShellApi

Defined in: [driver/src/api.ts:430](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L430)

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

### run()

> **run**(`command`, `options?`): `Promise`\<[`ShellCommandResult`](../shellcommandresult/)\>

Defined in: [driver/src/api.ts:433](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L433)

#### Parameters

##### command

`string`

##### options?

[`ShellRunOptions`](../shellrunoptions/)

#### Returns

`Promise`\<[`ShellCommandResult`](../shellcommandresult/)\>

***

### status()

> **status**(): [`ShellStatus`](../shellstatus/)

Defined in: [driver/src/api.ts:431](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L431)

#### Returns

[`ShellStatus`](../shellstatus/)

***

### waitForPrompt()

> **waitForPrompt**(`options?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:432](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L432)

#### Parameters

##### options?

[`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<`void`\>
