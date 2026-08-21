---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: [api.ts:123](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L123)

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

### events

> `readonly` **events**: [`SessionEvents`](../sessionevents/)

Defined in: [api.ts:188](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L188)

***

### exit

> `readonly` **exit**: `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [api.ts:206](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L206)

***

### scrollback

> `readonly` **scrollback**: [`ScrollbackApi`](../scrollbackapi/)

Defined in: [api.ts:184](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L184)

***

### selection

> `readonly` **selection**: [`SelectionApi`](../selectionapi/)

Defined in: [api.ts:185](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L185)

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [api.ts:124](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L124)

***

### shell

> `readonly` **shell**: [`ShellApi`](../shellapi/)

Defined in: [api.ts:126](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L126)

Shell command boundaries and prompt state when the child emits OSC 133.

## Methods

### blur()

> **blur**(): `Promise`\<`void`\>

Defined in: [api.ts:165](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L165)

#### Returns

`Promise`\<`void`\>

***

### capabilities()

> **capabilities**(): [`SessionCapabilities`](../sessioncapabilities/)

Defined in: [api.ts:128](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L128)

#### Returns

[`SessionCapabilities`](../sessioncapabilities/)

***

### cell()

> **cell**(`pos`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [api.ts:141](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L141)

#### Parameters

##### pos

###### column

`number`

###### row

`number`

#### Returns

[`CellSnapshot`](../cellsnapshot/)

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [api.ts:205](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L205)

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### crashReport()

> **crashReport**(): [`CrashReport`](../crashreport/) \| `null`

Defined in: [api.ts:202](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L202)

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

[`CrashReport`](../crashreport/) \| `null`

***

### diagnostics()

> **diagnostics**(): readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

Defined in: [api.ts:195](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L195)

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

***

### focus()

> **focus**(): `Promise`\<`void`\>

Defined in: [api.ts:164](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L164)

#### Returns

`Promise`\<`void`\>

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: [api.ts:145](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L145)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

###### exact?

`boolean`

#### Returns

[`Locator`](../locator/)

***

### getByRole()

> **getByRole**(`role`, `opts?`): [`Locator`](../locator/)

Defined in: [api.ts:144](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L144)

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

[`RoleLocatorOptions`](../rolelocatoroptions/)

#### Returns

[`Locator`](../locator/)

***

### getByTestId()

> **getByTestId**(`testId`): [`Locator`](../locator/)

Defined in: [api.ts:147](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L147)

#### Parameters

##### testId

`string`

#### Returns

[`Locator`](../locator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: [api.ts:146](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L146)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`TextLocatorOptions`](../textlocatoroptions/)

#### Returns

[`Locator`](../locator/)

***

### locator()

> **locator**(`selector`): [`Locator`](../locator/)

Defined in: [api.ts:149](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L149)

Textual-style CSS dialect: 'dialog button.primary:focused', '#id'.

#### Parameters

##### selector

`string`

#### Returns

[`Locator`](../locator/)

***

### locatorForRef()

> **locatorForRef**(`ref`): [`Locator`](../locator/)

Defined in: [api.ts:156](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L156)

Rebuilds a locator from a ref minted by [ResolvedTarget.ref](../resolvedtarget/#ref)
(`'n8@42'` for a semantic node, `'grid:r,c,w,h@7'` for a grid match).
The ref stays bound to its revision: resolving it after that revision was
superseded raises `stale-snapshot`.

#### Parameters

##### ref

`string`

#### Returns

[`Locator`](../locator/)

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: [api.ts:161](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L161)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [api.ts:159](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L159)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<[`ResizeReceipt`](../resizereceipt/)\>

Defined in: [api.ts:163](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L163)

#### Parameters

##### size

###### columns

`number`

###### rows

`number`

#### Returns

`Promise`\<[`ResizeReceipt`](../resizereceipt/)\>

***

### screen()

> **screen**(): [`ScreenSnapshot`](../screensnapshot/)

Defined in: [api.ts:139](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L139)

#### Returns

[`ScreenSnapshot`](../screensnapshot/)

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: [api.ts:140](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L140)

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<[`SessionCapabilities`](../sessioncapabilities/)\>

Defined in: [api.ts:138](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L138)

The capabilities, once they are final.

`capabilities()` answers immediately with what is known so far, which is
what a synchronous caller needs. This waits for the negotiation to reach
its verdict — including the grace an adapter gets to attach late — and, for
a semantic session, for the first tree to be published. After it resolves,
`semanticTree` will not change again.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`SessionCapabilities`](../sessioncapabilities/)\>

***

### signal()

> **signal**(`sig`): `Promise`\<`void`\>

Defined in: [api.ts:166](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L166)

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: [api.ts:180](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L180)

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [api.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L160)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [api.ts:179](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L179)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ExitStatus`](../exitstatus/)\>

***

### waitForIdle()

> **waitForIdle**(`opts?`): `Promise`\<`void`\>

Defined in: [api.ts:172](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L172)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForReady()

> **waitForReady**(`opts?`): `Promise`\<`void`\>

Defined in: [api.ts:178](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L178)

Waits until the program is ready for input: shell-integration prompt
marks (OSC 133) when the program emits them, otherwise a settled-screen
heuristic. Which one was used is reported as a `diagnostic` event.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: [api.ts:170](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L170)

#### Parameters

##### opts

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForStable()

> **waitForStable**(`opts?`): `Promise`\<`void`\>

Defined in: [api.ts:171](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L171)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [api.ts:169](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L169)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForTitle()

> **waitForTitle**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [api.ts:181](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L181)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### write()

> **write**(`bytes`): `Promise`\<`void`\>

Defined in: [api.ts:162](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L162)

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
