---
title: "Interface: ShellApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellApi

# Interface: ShellApi

Defined in: [driver/src/api.ts:377](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L377)

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

Defined in: [driver/src/api.ts:380](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L380)

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

Defined in: [driver/src/api.ts:378](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L378)

#### Returns

[`ShellStatus`](../shellstatus/)

***

### waitForPrompt()

> **waitForPrompt**(`options?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:379](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L379)

#### Parameters

##### options?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>
