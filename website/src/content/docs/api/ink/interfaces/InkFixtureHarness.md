---
title: "Interface: InkFixtureHarness"
editUrl: false
---

[**@termwright/ink-testing**](../../)

***

[@termwright/ink-testing](../../) / InkFixtureHarness

# Interface: InkFixtureHarness

Defined in: [ink-testing/src/fixture.ts:78](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/fixture.ts#L78)

A [TerminalHarness](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/) over a fixture process, plus the prop update only a
control channel can deliver.

## Extends

- [`TerminalHarness`](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/)

## Properties

### events

> `readonly` **events**: `SessionEvents`

Defined in: driver/dist/index.d.ts:161

#### Inherited from

`TerminalHarness.events`

***

### exit

> `readonly` **exit**: `Promise`\<`ExitStatus`\>

Defined in: driver/dist/index.d.ts:176

#### Inherited from

`TerminalHarness.exit`

***

### scrollback

> `readonly` **scrollback**: `ScrollbackApi`

Defined in: driver/dist/index.d.ts:159

#### Inherited from

`TerminalHarness.scrollback`

***

### selection

> `readonly` **selection**: `SelectionApi`

Defined in: driver/dist/index.d.ts:160

#### Inherited from

`TerminalHarness.selection`

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: driver/dist/index.d.ts:96

#### Inherited from

`TerminalHarness.sessionId`

***

### shell

> `readonly` **shell**: `ShellApi`

Defined in: driver/dist/index.d.ts:98

Shell command boundaries and prompt state when the child emits OSC 133.

#### Inherited from

`TerminalHarness.shell`

## Methods

### blur()

> **blur**(): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:140

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.blur`

***

### capabilities()

> **capabilities**(): `SessionCapabilities`

Defined in: driver/dist/index.d.ts:99

#### Returns

`SessionCapabilities`

#### Inherited from

`TerminalHarness.capabilities`

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

#### Inherited from

`TerminalHarness.cell`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:175

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.close`

***

### crashReport()

> **crashReport**(): `CrashReport` \| `null`

Defined in: driver/dist/index.d.ts:173

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

`CrashReport` \| `null`

#### Inherited from

`TerminalHarness.crashReport`

***

### diagnostics()

> **diagnostics**(): readonly `SessionDiagnostic`[]

Defined in: driver/dist/index.d.ts:167

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly `SessionDiagnostic`[]

#### Inherited from

`TerminalHarness.diagnostics`

***

### focus()

> **focus**(): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:139

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.focus`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:117

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

###### exact?

`boolean`

#### Returns

`Locator`

#### Inherited from

`TerminalHarness.getByLabel`

***

### getByRole()

> **getByRole**(`role`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:116

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

`RoleLocatorOptions`

#### Returns

`Locator`

#### Inherited from

`TerminalHarness.getByRole`

***

### getByTestId()

> **getByTestId**(`testId`): `Locator`

Defined in: driver/dist/index.d.ts:121

#### Parameters

##### testId

`string`

#### Returns

`Locator`

#### Inherited from

`TerminalHarness.getByTestId`

***

### getByText()

> **getByText**(`text`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:120

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`TextLocatorOptions`

#### Returns

`Locator`

#### Inherited from

`TerminalHarness.getByText`

***

### locator()

> **locator**(`selector`): `Locator`

Defined in: driver/dist/index.d.ts:123

Textual-style CSS dialect: 'dialog button.primary:focused', '#id'.

#### Parameters

##### selector

`string`

#### Returns

`Locator`

#### Inherited from

`TerminalHarness.locator`

***

### locatorForRef()

> **locatorForRef**(`ref`): `Locator`

Defined in: driver/dist/index.d.ts:130

Rebuilds a locator from a ref returned by a resolved target.
(`'n8@42'` for a semantic node, `'grid:r,c,w,h@7'` for a grid match).
The ref stays bound to its revision: resolving it after that revision was
superseded raises `stale-snapshot`.

#### Parameters

##### ref

`string`

#### Returns

`Locator`

#### Inherited from

`TerminalHarness.locatorForRef`

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:133

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.paste`

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:131

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.press`

***

### rerender()

> **rerender**(`props`, `opts?`): `Promise`\<`void`\>

Defined in: [ink-testing/src/fixture.ts:93](https://github.com/Gorce-AI/termwright/blob/main/packages/ink-testing/src/fixture.ts#L93)

Replaces the fixture's props and resolves once the resulting frame has been
committed and published.

The counterpart of `InkHarness.rerender`, and deliberately not the same
signature: a mount takes a React element because it shares a heap with the
test, while a fixture is another process and can only be sent data. Props
cross as bounded JSON over a private socket — never over stdin, which
belongs to the simulated user, and never as code.

The *component* is fixed when the fixture starts and is never re-resolved
from a message: a rerender changes what it is showing, never which code
runs.

#### Parameters

##### props

[`JsonProps`](../../type-aliases/jsonprops/)

##### opts?

[`SettleOptions`](../settleoptions/)

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

#### Inherited from

`TerminalHarness.resize`

***

### screen()

> **screen**(): `ScreenSnapshot`

Defined in: driver/dist/index.d.ts:110

#### Returns

`ScreenSnapshot`

#### Inherited from

`TerminalHarness.screen`

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: driver/dist/index.d.ts:111

#### Returns

`SemanticSnapshot` \| `null`

#### Inherited from

`TerminalHarness.semanticTree`

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

#### Inherited from

`TerminalHarness.settled`

***

### signal()

> **signal**(`sig`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:141

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.signal`

***

### title()

> **title**(): `string`

Defined in: driver/dist/index.d.ts:157

#### Returns

`string`

#### Inherited from

`TerminalHarness.title`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:132

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.type`

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<`ExitStatus`\>

Defined in: driver/dist/index.d.ts:156

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ExitStatus`\>

#### Inherited from

`TerminalHarness.waitForExit`

***

### waitForIdle()

> **waitForIdle**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:149

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.waitForIdle`

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

#### Inherited from

`TerminalHarness.waitForReady`

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:143

#### Parameters

##### opts

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.waitForRender`

***

### waitForStable()

> **waitForStable**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:146

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.waitForStable`

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

#### Inherited from

`TerminalHarness.waitForText`

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

#### Inherited from

`TerminalHarness.waitForTitle`

***

### write()

> **write**(`bytes`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:134

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.write`
