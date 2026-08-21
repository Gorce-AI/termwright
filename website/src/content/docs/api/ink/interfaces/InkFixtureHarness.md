---
title: "Interface: InkFixtureHarness"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / InkFixtureHarness

# Interface: InkFixtureHarness

Defined in: [ink/src/fixture.ts:78](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/fixture.ts#L78)

A [TerminalHarness](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/) over a fixture process, plus the prop update only a
control channel can deliver.

## Extends

- [`TerminalHarness`](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/)

## Properties

### events

> `readonly` **events**: `SessionEvents`

Defined in: driver/dist/index.d.ts:174

#### Inherited from

`TerminalHarness.events`

***

### exit

> `readonly` **exit**: `Promise`\<`ExitStatus`\>

Defined in: driver/dist/index.d.ts:195

#### Inherited from

`TerminalHarness.exit`

***

### keyboard

> `readonly` **keyboard**: `Keyboard`

Defined in: driver/dist/index.d.ts:97

One physical keyboard implementation. Convenience methods delegate here.

#### Inherited from

`TerminalHarness.keyboard`

***

### mouse

> `readonly` **mouse**: `Mouse`

Defined in: driver/dist/index.d.ts:99

One physical mouse implementation. Locator actions delegate here after planning.

#### Inherited from

`TerminalHarness.mouse`

***

### scrollback

> `readonly` **scrollback**: `ScrollbackApi`

Defined in: driver/dist/index.d.ts:172

#### Inherited from

`TerminalHarness.scrollback`

***

### selection

> `readonly` **selection**: `SelectionApi`

Defined in: driver/dist/index.d.ts:173

#### Inherited from

`TerminalHarness.selection`

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: driver/dist/index.d.ts:93

#### Inherited from

`TerminalHarness.sessionId`

***

### shell

> `readonly` **shell**: `ShellApi`

Defined in: driver/dist/index.d.ts:95

Shell command boundaries and prompt state when the child emits OSC 133.

#### Inherited from

`TerminalHarness.shell`

***

### terminalState

> `readonly` **terminalState**: `TerminalState`

Defined in: driver/dist/index.d.ts:103

Emulator facts captured together at the current screen revision.

#### Inherited from

`TerminalHarness.terminalState`

***

### window

> `readonly` **window**: `TerminalWindow`

Defined in: driver/dist/index.d.ts:101

Terminal-window focus reports, distinct from semantic element focus.

#### Inherited from

`TerminalHarness.window`

## Methods

### appLogs()

> **appLogs**(): readonly `AppLogEvent`[]

Defined in: driver/dist/index.d.ts:186

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly `AppLogEvent`[]

#### Inherited from

`TerminalHarness.appLogs`

***

### capabilities()

> **capabilities**(): `SessionCapabilities`

Defined in: driver/dist/index.d.ts:104

#### Returns

`SessionCapabilities`

#### Inherited from

`TerminalHarness.capabilities`

***

### cell()

> **cell**(`pos`): `CellSnapshot`

Defined in: driver/dist/index.d.ts:124

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

### checkpoint()

> **checkpoint**(): `ObservationStamp`

Defined in: driver/dist/index.d.ts:108

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

`ObservationStamp`

#### Inherited from

`TerminalHarness.checkpoint`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:194

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.close`

***

### contract()

> **contract**(): `EffectiveSessionContract` \| `null`

Defined in: driver/dist/index.d.ts:106

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

`EffectiveSessionContract` \| `null`

#### Inherited from

`TerminalHarness.contract`

***

### crashReport()

> **crashReport**(): `CrashReport` \| `null`

Defined in: driver/dist/index.d.ts:192

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

Defined in: driver/dist/index.d.ts:180

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly `SessionDiagnostic`[]

#### Inherited from

`TerminalHarness.diagnostics`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:129

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

Defined in: driver/dist/index.d.ts:128

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

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `Locator`

Defined in: driver/dist/index.d.ts:135

Physical terminal-grid text, optionally narrowed by occurrence or style.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`ScreenTextLocatorOptions`

#### Returns

`Locator`

#### Inherited from

`TerminalHarness.getByScreenText`

***

### getByTestId()

> **getByTestId**(`testId`): `Locator`

Defined in: driver/dist/index.d.ts:136

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

Defined in: driver/dist/index.d.ts:133

Semantic text only. Never falls back to the terminal grid.

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

Defined in: driver/dist/index.d.ts:138

Advanced Termwright semantic selector: 'dialog button.primary:focused', '#id'.

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

Defined in: driver/dist/index.d.ts:145

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

Defined in: driver/dist/index.d.ts:148

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

Defined in: driver/dist/index.d.ts:146

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

Defined in: [ink/src/fixture.ts:93](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/fixture.ts#L93)

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

Defined in: driver/dist/index.d.ts:150

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

Defined in: driver/dist/index.d.ts:122

#### Returns

`ScreenSnapshot`

#### Inherited from

`TerminalHarness.screen`

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: driver/dist/index.d.ts:123

#### Returns

`SemanticSnapshot` \| `null`

#### Inherited from

`TerminalHarness.semanticTree`

***

### settled()

> **settled**(`opts?`): `Promise`\<`EffectiveSessionContract`\>

Defined in: driver/dist/index.d.ts:121

The capabilities, once they are final.

`capabilities()` answers immediately with what is known so far, which is
what a synchronous caller needs. This waits for the negotiation to reach
its verdict and, for a semantic session, for the first tree to be published. After it resolves,
`semanticTree` will not change again.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`EffectiveSessionContract`\>

#### Inherited from

`TerminalHarness.settled`

***

### signal()

> **signal**(`sig`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:154

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

Defined in: driver/dist/index.d.ts:170

#### Returns

`string`

#### Inherited from

`TerminalHarness.title`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/index.d.ts:147

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.type`

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/index.d.ts:110

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & `WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

#### Inherited from

`TerminalHarness.waitForCheckpointChange`

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<`ExitStatus`\>

Defined in: driver/dist/index.d.ts:169

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

Defined in: driver/dist/index.d.ts:162

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

Defined in: driver/dist/index.d.ts:168

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

Defined in: driver/dist/index.d.ts:156

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

Defined in: driver/dist/index.d.ts:159

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

Defined in: driver/dist/index.d.ts:155

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

Defined in: driver/dist/index.d.ts:171

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

Defined in: driver/dist/index.d.ts:149

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.write`
