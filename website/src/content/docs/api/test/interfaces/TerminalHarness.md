---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: driver/dist/session-BJCkoLyr.d.ts:95

## Properties

### events

> `readonly` **events**: `SessionEvents`

Defined in: driver/dist/session-BJCkoLyr.d.ts:179

***

### exit

> `readonly` **exit**: `Promise`\<`ExitStatus`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:200

***

### keyboard

> `readonly` **keyboard**: `Keyboard`

Defined in: driver/dist/session-BJCkoLyr.d.ts:102

One physical keyboard implementation. Convenience methods delegate here.

***

### mouse

> `readonly` **mouse**: `Mouse`

Defined in: driver/dist/session-BJCkoLyr.d.ts:104

One physical mouse implementation. Locator actions delegate here after planning.

***

### scrollback

> `readonly` **scrollback**: `ScrollbackApi`

Defined in: driver/dist/session-BJCkoLyr.d.ts:177

***

### selection

> `readonly` **selection**: `SelectionApi`

Defined in: driver/dist/session-BJCkoLyr.d.ts:178

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: driver/dist/session-BJCkoLyr.d.ts:96

***

### shell

> `readonly` **shell**: `ShellApi`

Defined in: driver/dist/session-BJCkoLyr.d.ts:100

Shell command boundaries and prompt state when the child emits OSC 133.

***

### terminalProfile

> `readonly` **terminalProfile**: `string`

Defined in: driver/dist/session-BJCkoLyr.d.ts:98

Immutable terminal profile used to decode the very first PTY byte.

***

### terminalState

> `readonly` **terminalState**: `TerminalState`

Defined in: driver/dist/session-BJCkoLyr.d.ts:108

Emulator facts captured together at the current screen revision.

***

### window

> `readonly` **window**: `TerminalWindow`

Defined in: driver/dist/session-BJCkoLyr.d.ts:106

Terminal-window focus reports, distinct from semantic element focus.

## Methods

### appLogs()

> **appLogs**(): readonly `AppLogEvent`[]

Defined in: driver/dist/session-BJCkoLyr.d.ts:191

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly `AppLogEvent`[]

***

### bindOperationBudget()?

> `optional` **bindOperationBudget**(`budget`): `void`

Defined in: driver/dist/session-BJCkoLyr.d.ts:110

Binds one attempt-wide budget before any user operation starts.

#### Parameters

##### budget

`OperationBudget`

#### Returns

`void`

***

### cell()

> **cell**(`pos`): `CellSnapshot`

Defined in: driver/dist/session-BJCkoLyr.d.ts:131

#### Parameters

##### pos

###### column

`number`

###### row

`number`

#### Returns

`CellSnapshot`

***

### checkpoint()

> **checkpoint**(): `ObservationStamp`

Defined in: driver/dist/session-BJCkoLyr.d.ts:114

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

`ObservationStamp`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:199

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### contract()

> **contract**(): `EffectiveSessionContract` \| `null`

Defined in: driver/dist/session-BJCkoLyr.d.ts:112

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

`EffectiveSessionContract` \| `null`

***

### crashReport()

> **crashReport**(): `CrashReport` \| `null`

Defined in: driver/dist/session-BJCkoLyr.d.ts:197

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

`CrashReport` \| `null`

***

### diagnostics()

> **diagnostics**(): readonly `SessionDiagnostic`[]

Defined in: driver/dist/session-BJCkoLyr.d.ts:185

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly `SessionDiagnostic`[]

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:136

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

###### exact?

`boolean`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### getByRole()

> **getByRole**(`role`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:135

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

`RoleLocatorOptions`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): [`ScreenLocator`](../screenlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:142

Physical terminal-grid text, optionally narrowed by occurrence or style.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`ScreenTextLocatorOptions`

#### Returns

[`ScreenLocator`](../screenlocator/)

***

### getByTestId()

> **getByTestId**(`testId`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:143

#### Parameters

##### testId

`string`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:140

Semantic text only. Never falls back to the terminal grid.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

`TextLocatorOptions`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### locator()

> **locator**(`selector`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:145

Advanced Termwright semantic selector: 'dialog button.primary:focused', '#id'.

#### Parameters

##### selector

`string`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### locatorForRef()

#### Call Signature

> **locatorForRef**(`ref`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:152

Rebuilds a locator from a ref returned by a resolved target.
(`'semantic:n8@42'` for a semantic node, `'screen:r,c,w,h@7'` for a grid match).
The ref stays bound to its revision: resolving it after that revision was
superseded raises `stale-snapshot`.

##### Parameters

###### ref

`` `semantic:${string}@${number}` ``

##### Returns

[`SemanticLocator`](../semanticlocator/)

#### Call Signature

> **locatorForRef**(`ref`): [`ScreenLocator`](../screenlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:153

##### Parameters

###### ref

`` `screen:${number},${number},${number},${number}@${number}` ``

##### Returns

[`ScreenLocator`](../screenlocator/)

#### Call Signature

> **locatorForRef**(`ref`): [`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

Defined in: driver/dist/session-BJCkoLyr.d.ts:154

##### Parameters

###### ref

`LocatorRef`

##### Returns

[`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:157

#### Parameters

##### text

`ExecutableValue`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:155

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<`ResizeReceipt`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:159

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

Defined in: driver/dist/session-BJCkoLyr.d.ts:129

#### Returns

`ScreenSnapshot`

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: driver/dist/session-BJCkoLyr.d.ts:130

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<`EffectiveSessionContract`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:128

Waits for the one frozen Effective Session Contract and, for a semantic
session, for the first paired tree. There is no provisional capability API.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`EffectiveSessionContract`\>

***

### signal()

> **signal**(`sig`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:163

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: driver/dist/session-BJCkoLyr.d.ts:175

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:156

#### Parameters

##### text

`ExecutableValue`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:116

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & `WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

***

### waitForCommittedObservation()

> **waitForCommittedObservation**(`opts?`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:123

Waits until parser work and semantic frame pairing caused by prior input
have committed. This is not a quiet/global-idle heuristic.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<`ExitStatus`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:174

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ExitStatus`\>

***

### waitForQuiet()

> **waitForQuiet**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:169

Heuristic only: waits for a stated interval with no screen or semantic change.

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:165

#### Parameters

##### opts

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForShellPrompt()

> **waitForShellPrompt**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:173

Authoritative: waits for an OSC 133 prompt marker from shell integration.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-BJCkoLyr.d.ts:164

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

Defined in: driver/dist/session-BJCkoLyr.d.ts:176

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

Defined in: driver/dist/session-BJCkoLyr.d.ts:158

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
