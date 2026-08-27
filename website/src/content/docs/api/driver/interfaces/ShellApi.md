---
title: "Interface: ShellApi"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ShellApi

# Interface: ShellApi

Defined in: [driver/src/api.ts:366](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L366)

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

Defined in: [driver/src/api.ts:369](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L369)

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

Defined in: [driver/src/api.ts:367](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L367)

#### Returns

[`ShellStatus`](../shellstatus/)

***

### waitForPrompt()

> **waitForPrompt**(`options?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:368](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L368)

#### Parameters

##### options?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>
