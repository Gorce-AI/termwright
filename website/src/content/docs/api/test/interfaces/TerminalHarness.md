---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: driver/dist/session-DOkKra9W.d.ts:120

## Properties

### artifactSecurity

> `readonly` **artifactSecurity**: `ResolvedArtifactSecurityPolicy`

Defined in: driver/dist/session-DOkKra9W.d.ts:123

Resolved policy inherited by traces, reports and other artifact sinks.

***

### events

> `readonly` **events**: `SessionEvents`

Defined in: driver/dist/session-DOkKra9W.d.ts:208

***

### exit

> `readonly` **exit**: `Promise`\<`ExitStatus`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:234

***

### keyboard

> `readonly` **keyboard**: `Keyboard`

Defined in: driver/dist/session-DOkKra9W.d.ts:129

One physical keyboard implementation. Convenience methods delegate here.

***

### mouse

> `readonly` **mouse**: `Mouse`

Defined in: driver/dist/session-DOkKra9W.d.ts:131

One physical mouse implementation. Locator actions delegate here after planning.

***

### scrollback

> `readonly` **scrollback**: `ScrollbackApi`

Defined in: driver/dist/session-DOkKra9W.d.ts:206

***

### selection

> `readonly` **selection**: `SelectionApi`

Defined in: driver/dist/session-DOkKra9W.d.ts:207

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: driver/dist/session-DOkKra9W.d.ts:121

***

### shell

> `readonly` **shell**: `ShellApi`

Defined in: driver/dist/session-DOkKra9W.d.ts:127

Shell command boundaries and prompt state when the child emits OSC 133.

***

### terminalProfile

> `readonly` **terminalProfile**: `TerminalProfileId`

Defined in: driver/dist/session-DOkKra9W.d.ts:125

Immutable terminal profile used to decode the very first PTY byte.

***

### terminalState

> `readonly` **terminalState**: `TerminalState`

Defined in: driver/dist/session-DOkKra9W.d.ts:135

Emulator facts captured together at the current screen revision.

***

### window

> `readonly` **window**: `TerminalWindow`

Defined in: driver/dist/session-DOkKra9W.d.ts:133

Terminal-window focus reports, distinct from semantic element focus.

## Methods

### appLogs()

> **appLogs**(): readonly `AppLogEvent`[]

Defined in: driver/dist/session-DOkKra9W.d.ts:220

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly `AppLogEvent`[]

***

### bindOperationBudget()?

> `optional` **bindOperationBudget**(`budget`): `void`

Defined in: driver/dist/session-DOkKra9W.d.ts:137

Binds one attempt-wide budget before any user operation starts.

#### Parameters

##### budget

`OperationBudget`

#### Returns

`void`

***

### cell()

> **cell**(`pos`): `CellSnapshot`

Defined in: driver/dist/session-DOkKra9W.d.ts:160

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

Defined in: driver/dist/session-DOkKra9W.d.ts:141

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

`ObservationStamp`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:233

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### contract()

> **contract**(): `EffectiveSessionContract` \| `null`

Defined in: driver/dist/session-DOkKra9W.d.ts:139

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

`EffectiveSessionContract` \| `null`

***

### crashReport()

> **crashReport**(): `CrashReport` \| `null`

Defined in: driver/dist/session-DOkKra9W.d.ts:226

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

`CrashReport` \| `null`

***

### diagnostics()

> **diagnostics**(): readonly `SessionDiagnostic`[]

Defined in: driver/dist/session-DOkKra9W.d.ts:214

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly `SessionDiagnostic`[]

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-DOkKra9W.d.ts:165

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

Defined in: driver/dist/session-DOkKra9W.d.ts:164

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

Defined in: driver/dist/session-DOkKra9W.d.ts:171

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

Defined in: driver/dist/session-DOkKra9W.d.ts:172

#### Parameters

##### testId

`string`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: driver/dist/session-DOkKra9W.d.ts:169

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

Defined in: driver/dist/session-DOkKra9W.d.ts:174

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

Defined in: driver/dist/session-DOkKra9W.d.ts:181

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

Defined in: driver/dist/session-DOkKra9W.d.ts:182

##### Parameters

###### ref

`` `screen:${number},${number},${number},${number}@${number}` ``

##### Returns

[`ScreenLocator`](../screenlocator/)

#### Call Signature

> **locatorForRef**(`ref`): [`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

Defined in: driver/dist/session-DOkKra9W.d.ts:183

##### Parameters

###### ref

`LocatorRef`

##### Returns

[`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

***

### ownedProcessResources()

> **ownedProcessResources**(): `OwnedProcessResourceUsage` \| `null`

Defined in: driver/dist/session-DOkKra9W.d.ts:231

Native whole-tree accounting captured immediately before PTY disposal.
Returns `null` when the backend cannot make an authoritative claim.

#### Returns

`OwnedProcessResourceUsage` \| `null`

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:186

#### Parameters

##### text

`ExecutableValue`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:184

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<`ResizeReceipt`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:188

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

Defined in: driver/dist/session-DOkKra9W.d.ts:158

#### Returns

`ScreenSnapshot`

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: driver/dist/session-DOkKra9W.d.ts:159

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<`EffectiveSessionContract`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:157

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

Defined in: driver/dist/session-DOkKra9W.d.ts:192

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: driver/dist/session-DOkKra9W.d.ts:204

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:185

#### Parameters

##### text

`ExecutableValue`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:143

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & `WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

***

### waitForCommittedObservation()

> **waitForCommittedObservation**(`opts?`): `Promise`\<`ObservationStamp`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:152

Waits until currently observable parser work, semantic frame pairing and
provider-evidence invalidation have committed. This cannot predict a
future semantic frame before either of its causal signals reaches the
driver, and it is not a quiet/global-idle heuristic.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ObservationStamp`\>

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<`ExitStatus`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:203

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`ExitStatus`\>

***

### waitForQuiet()

> **waitForQuiet**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:198

Heuristic only: waits for a stated interval with no screen or semantic change.

#### Parameters

##### opts?

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:194

#### Parameters

##### opts

`object` & `WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForShellPrompt()

> **waitForShellPrompt**(`opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:202

Authoritative: waits for an OSC 133 prompt marker from shell integration.

#### Parameters

##### opts?

`WaitOptions`

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: driver/dist/session-DOkKra9W.d.ts:193

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

Defined in: driver/dist/session-DOkKra9W.d.ts:205

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

Defined in: driver/dist/session-DOkKra9W.d.ts:187

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
