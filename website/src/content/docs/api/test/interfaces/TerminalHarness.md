---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: driver/dist/index.d.ts:95

## Properties

### events

> `readonly` **events**: `SessionEvents`

Defined in: driver/dist/index.d.ts:161

***

### exit

> `readonly` **exit**: `Promise`\<`ExitStatus`\>

Defined in: driver/dist/index.d.ts:176

***

### scrollback

> `readonly` **scrollback**: `ScrollbackApi`

Defined in: driver/dist/index.d.ts:159

***

### selection

> `readonly` **selection**: `SelectionApi`

Defined in: driver/dist/index.d.ts:160

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: driver/dist/index.d.ts:96

***

### shell

> `readonly` **shell**: `ShellApi`

Defined in: driver/dist/index.d.ts:98

Shell command boundaries and prompt state when the child emits OSC 133.

## Methods

### blur()

> **blur**(): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:140

#### Returns

`Promise`\<`void`\>

***

### capabilities()

> **capabilities**(): `SessionCapabilities`

Defined in: driver/dist/index.d.ts:99

#### Returns

`SessionCapabilities`

***

### cell()

> **cell**(`pos`): `CellSnapshot`

Defined in: driver/dist/index.d.ts:112

#### Parameters

##### pos

###### column

`number`

###### row

`number`

#### Returns

`CellSnapshot`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:175

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### crashReport()

> **crashReport**(): `CrashReport` \| `null`

Defined in: driver/dist/index.d.ts:173

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

`CrashReport` \| `null`

***

### diagnostics()

> **diagnostics**(): readonly `SessionDiagnostic`[]

Defined in: driver/dist/index.d.ts:167

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly `SessionDiagnostic`[]

***

### focus()

> **focus**(): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:139

#### Returns

`Promise`\<`void`\>

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: driver/dist/index.d.ts:117

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

Defined in: driver/dist/index.d.ts:116

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

`RoleLocatorOptions`

#### Returns

[`Locator`](../locator/)

***

### getByTestId()

> **getByTestId**(`testId`): [`Locator`](../locator/)

Defined in: driver/dist/index.d.ts:121

#### Parameters

##### testId

`string`

#### Returns

[`Locator`](../locator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: driver/dist/index.d.ts:120

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`TextLocatorOptions`

#### Returns

[`Locator`](../locator/)

***

### locator()

> **locator**(`selector`): [`Locator`](../locator/)

Defined in: driver/dist/index.d.ts:123

Textual-style CSS dialect: 'dialog button.primary:focused', '#id'.

#### Parameters

##### selector

`string`

#### Returns

[`Locator`](../locator/)

***

### locatorForRef()

> **locatorForRef**(`ref`): [`Locator`](../locator/)

Defined in: driver/dist/index.d.ts:130

Rebuilds a locator from a ref returned by a resolved target.
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

Defined in: driver/dist/index.d.ts:133

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:131

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<`ResizeReceipt`\>

Defined in: driver/dist/index.d.ts:135

#### Parameters

##### size

###### columns

`number`

###### rows

`number`

#### Returns

`Promise`\<`ResizeReceipt`\>

***

### screen()

> **screen**(): `ScreenSnapshot`

Defined in: driver/dist/index.d.ts:110

#### Returns

`ScreenSnapshot`

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: driver/dist/index.d.ts:111

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<`SessionCapabilities`\>

Defined in: driver/dist/index.d.ts:109

The capabilities, once they are final.

`capabilities()` answers immediately with what is known so far, which is
what a synchronous caller needs. This waits for the negotiation to reach
its verdict — including the grace an adapter gets to attach late — and, for
a semantic session, for the first tree to be published. After it resolves,
`semanticTree` will not change again.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`SessionCapabilities`\>

***

### signal()

> **signal**(`sig`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:141

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: driver/dist/index.d.ts:157

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:132

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<`ExitStatus`\>

Defined in: driver/dist/index.d.ts:156

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ExitStatus`\>

***

### waitForIdle()

> **waitForIdle**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:149

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForReady()

> **waitForReady**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:155

Waits until the program is ready for input: shell-integration prompt
marks (OSC 133) when the program emits them, otherwise a settled-screen
heuristic. Which one was used is reported as a `diagnostic` event.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:143

#### Parameters

##### opts

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForStable()

> **waitForStable**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:146

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:142

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForTitle()

> **waitForTitle**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:158

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### write()

> **write**(`bytes`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:134

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
