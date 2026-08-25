---
title: "Interface: InkFixtureHarness"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / InkFixtureHarness

# Interface: InkFixtureHarness

Defined in: [ink/src/fixture.ts:80](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/fixture.ts#L80)

A [TerminalHarness](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/) over a fixture process, plus the prop update only a
control channel can deliver.

## Extends

- [`TerminalHarness`](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/)

## Properties

### events

> `readonly` **events**: `SessionEvents`

Defined in: driver/dist/session-Qtj2njLI.d.ts:177

#### Inherited from

`TerminalHarness.events`

***

### exit

> `readonly` **exit**: `Promise`\<`ExitStatus`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:198

#### Inherited from

`TerminalHarness.exit`

***

### keyboard

> `readonly` **keyboard**: `Keyboard`

Defined in: driver/dist/session-Qtj2njLI.d.ts:100

One physical keyboard implementation. Convenience methods delegate here.

#### Inherited from

`TerminalHarness.keyboard`

***

### mouse

> `readonly` **mouse**: `Mouse`

Defined in: driver/dist/session-Qtj2njLI.d.ts:102

One physical mouse implementation. Locator actions delegate here after planning.

#### Inherited from

`TerminalHarness.mouse`

***

### scrollback

> `readonly` **scrollback**: `ScrollbackApi`

Defined in: driver/dist/session-Qtj2njLI.d.ts:175

#### Inherited from

`TerminalHarness.scrollback`

***

### selection

> `readonly` **selection**: `SelectionApi`

Defined in: driver/dist/session-Qtj2njLI.d.ts:176

#### Inherited from

`TerminalHarness.selection`

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: driver/dist/session-Qtj2njLI.d.ts:94

#### Inherited from

`TerminalHarness.sessionId`

***

### shell

> `readonly` **shell**: `ShellApi`

Defined in: driver/dist/session-Qtj2njLI.d.ts:98

Shell command boundaries and prompt state when the child emits OSC 133.

#### Inherited from

`TerminalHarness.shell`

***

### terminalProfile

> `readonly` **terminalProfile**: `string`

Defined in: driver/dist/session-Qtj2njLI.d.ts:96

Immutable terminal profile used to decode the very first PTY byte.

#### Inherited from

`TerminalHarness.terminalProfile`

***

### terminalState

> `readonly` **terminalState**: `TerminalState`

Defined in: driver/dist/session-Qtj2njLI.d.ts:106

Emulator facts captured together at the current screen revision.

#### Inherited from

`TerminalHarness.terminalState`

***

### window

> `readonly` **window**: `TerminalWindow`

Defined in: driver/dist/session-Qtj2njLI.d.ts:104

Terminal-window focus reports, distinct from semantic element focus.

#### Inherited from

`TerminalHarness.window`

## Methods

### appLogs()

> **appLogs**(): readonly `AppLogEvent`[]

Defined in: driver/dist/session-Qtj2njLI.d.ts:189

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly `AppLogEvent`[]

#### Inherited from

`TerminalHarness.appLogs`

***

### bindOperationBudget()?

> `optional` **bindOperationBudget**(`budget`): `void`

Defined in: driver/dist/session-Qtj2njLI.d.ts:108

Binds one attempt-wide budget before any user operation starts.

#### Parameters

##### budget

`OperationBudget`

#### Returns

`void`

#### Inherited from

`TerminalHarness.bindOperationBudget`

***

### cell()

> **cell**(`pos`): `CellSnapshot`

Defined in: driver/dist/session-Qtj2njLI.d.ts:129

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:112

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

`ObservationStamp`

#### Inherited from

`TerminalHarness.checkpoint`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:197

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.close`

***

### contract()

> **contract**(): `EffectiveSessionContract` \| `null`

Defined in: driver/dist/session-Qtj2njLI.d.ts:110

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

`EffectiveSessionContract` \| `null`

#### Inherited from

`TerminalHarness.contract`

***

### crashReport()

> **crashReport**(): `CrashReport` \| `null`

Defined in: driver/dist/session-Qtj2njLI.d.ts:195

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:183

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly `SessionDiagnostic`[]

#### Inherited from

`TerminalHarness.diagnostics`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:134

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

###### exact?

`boolean`

#### Returns

`SemanticLocator`

#### Inherited from

`TerminalHarness.getByLabel`

***

### getByRole()

> **getByRole**(`role`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:133

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

`RoleLocatorOptions`

#### Returns

`SemanticLocator`

#### Inherited from

`TerminalHarness.getByRole`

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): `ScreenLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:140

Physical terminal-grid text, optionally narrowed by occurrence or style.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`ScreenTextLocatorOptions`

#### Returns

`ScreenLocator`

#### Inherited from

`TerminalHarness.getByScreenText`

***

### getByTestId()

> **getByTestId**(`testId`): `SemanticLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:141

#### Parameters

##### testId

`string`

#### Returns

`SemanticLocator`

#### Inherited from

`TerminalHarness.getByTestId`

***

### getByText()

> **getByText**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:138

Semantic text only. Never falls back to the terminal grid.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`TextLocatorOptions`

#### Returns

`SemanticLocator`

#### Inherited from

`TerminalHarness.getByText`

***

### locator()

> **locator**(`selector`): `SemanticLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:143

Advanced Termwright semantic selector: 'dialog button.primary:focused', '#id'.

#### Parameters

##### selector

`string`

#### Returns

`SemanticLocator`

#### Inherited from

`TerminalHarness.locator`

***

### locatorForRef()

#### Call Signature

> **locatorForRef**(`ref`): `SemanticLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:150

Rebuilds a locator from a ref returned by a resolved target.
(`'semantic:n8@42'` for a semantic node, `'screen:r,c,w,h@7'` for a grid match).
The ref stays bound to its revision: resolving it after that revision was
superseded raises `stale-snapshot`.

##### Parameters

###### ref

`` `semantic:${string}@${number}` ``

##### Returns

`SemanticLocator`

##### Inherited from

`TerminalHarness.locatorForRef`

#### Call Signature

> **locatorForRef**(`ref`): `ScreenLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:151

##### Parameters

###### ref

`` `screen:${number},${number},${number},${number}@${number}` ``

##### Returns

`ScreenLocator`

##### Inherited from

`TerminalHarness.locatorForRef`

#### Call Signature

> **locatorForRef**(`ref`): `SemanticLocator` \| `ScreenLocator`

Defined in: driver/dist/session-Qtj2njLI.d.ts:152

##### Parameters

###### ref

`LocatorRef`

##### Returns

`SemanticLocator` \| `ScreenLocator`

##### Inherited from

`TerminalHarness.locatorForRef`

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:155

#### Parameters

##### text

`ExecutableValue`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.paste`

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:153

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

Defined in: [ink/src/fixture.ts:95](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/fixture.ts#L95)

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:157

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:127

#### Returns

`ScreenSnapshot`

#### Inherited from

`TerminalHarness.screen`

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: driver/dist/session-Qtj2njLI.d.ts:128

#### Returns

`SemanticSnapshot` \| `null`

#### Inherited from

`TerminalHarness.semanticTree`

***

### settled()

> **settled**(`opts?`): `Promise`\<`EffectiveSessionContract`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:126

Waits for the one frozen Effective Session Contract and, for a semantic
session, for the first paired tree. There is no provisional capability API.

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:161

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:173

#### Returns

`string`

#### Inherited from

`TerminalHarness.title`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:154

#### Parameters

##### text

`ExecutableValue`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.type`

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:114

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & `WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

#### Inherited from

`TerminalHarness.waitForCheckpointChange`

***

### waitForCommittedObservation()

> **waitForCommittedObservation**(`opts?`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:121

Waits until parser work and semantic frame pairing caused by prior input
have committed. This is not a quiet/global-idle heuristic.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

#### Inherited from

`TerminalHarness.waitForCommittedObservation`

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<`ExitStatus`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:172

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ExitStatus`\>

#### Inherited from

`TerminalHarness.waitForExit`

***

### waitForQuiet()

> **waitForQuiet**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:167

Heuristic only: waits for a stated interval with no screen or semantic change.

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.waitForQuiet`

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:163

#### Parameters

##### opts

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.waitForRender`

***

### waitForShellPrompt()

> **waitForShellPrompt**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:171

Authoritative: waits for an OSC 133 prompt marker from shell integration.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.waitForShellPrompt`

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-Qtj2njLI.d.ts:162

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:174

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

Defined in: driver/dist/session-Qtj2njLI.d.ts:156

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.write`
