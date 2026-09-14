---
title: "Interface: InkHarness"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / InkHarness

# Interface: InkHarness

Defined in: [ink/src/mount.tsx:93](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/mount.tsx#L93)

A [TerminalHarness](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/) over an in-process Ink application, plus the two
things only an in-process mount can offer.

## Extends

- [`TerminalHarness`](https://gorce-ai.github.io/termwright/api/driver/interfaces/terminalharness/)

## Properties

### artifactSecurity

> `readonly` **artifactSecurity**: `ResolvedArtifactSecurityPolicy`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:141

Resolved policy inherited by traces, reports and other artifact sinks.

#### Inherited from

`TerminalHarness.artifactSecurity`

***

### events

> `readonly` **events**: `SessionEvents`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:237

#### Inherited from

`TerminalHarness.events`

***

### exit

> `readonly` **exit**: `Promise`\<`ExitStatus`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:263

#### Inherited from

`TerminalHarness.exit`

***

### keyboard

> `readonly` **keyboard**: `Keyboard`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:147

One physical keyboard implementation. Convenience methods delegate here.

#### Inherited from

`TerminalHarness.keyboard`

***

### mouse

> `readonly` **mouse**: `Mouse`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:149

One physical mouse implementation. Locator actions delegate here after planning.

#### Inherited from

`TerminalHarness.mouse`

***

### scrollback

> `readonly` **scrollback**: `ScrollbackApi`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:235

#### Inherited from

`TerminalHarness.scrollback`

***

### selection

> `readonly` **selection**: `SelectionApi`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:236

#### Inherited from

`TerminalHarness.selection`

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:139

#### Inherited from

`TerminalHarness.sessionId`

***

### shell

> `readonly` **shell**: `ShellApi`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:145

Shell command boundaries and prompt state when the child emits OSC 133.

#### Inherited from

`TerminalHarness.shell`

***

### terminalProfile

> `readonly` **terminalProfile**: `TerminalProfileId`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:143

Immutable terminal profile used to decode the very first PTY byte.

#### Inherited from

`TerminalHarness.terminalProfile`

***

### terminalState

> `readonly` **terminalState**: `TerminalState`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:153

Emulator facts captured together at the current screen revision.

#### Inherited from

`TerminalHarness.terminalState`

***

### window

> `readonly` **window**: `TerminalWindow`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:151

Terminal-window focus reports, distinct from semantic element focus.

#### Inherited from

`TerminalHarness.window`

## Methods

### appLogs()

> **appLogs**(): readonly `AppLogEvent`[]

Defined in: driver/dist/session-Bg0dDZp-.d.ts:249

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:155

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:189

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:159

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

`ObservationStamp`

#### Inherited from

`TerminalHarness.checkpoint`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:262

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.close`

***

### contract()

> **contract**(): `EffectiveSessionContract` \| `null`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:157

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

`EffectiveSessionContract` \| `null`

#### Inherited from

`TerminalHarness.contract`

***

### crashReport()

> **crashReport**(): `CrashReport` \| `null`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:255

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:243

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly `SessionDiagnostic`[]

#### Inherited from

`TerminalHarness.diagnostics`

***

### focusByTraversal()

> **focusByTraversal**(`target`, `options?`): `Promise`\<`void`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:181

Reaches a semantic target through the application's real keyboard focus
ring. Every key is followed by a committed focus change before continuing.

#### Parameters

##### target

`SemanticLocator`

##### options?

`FocusTraversalOptions`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.focusByTraversal`

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): `SemanticLocator`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:194

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:193

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:200

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:201

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:198

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:203

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:210

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:211

##### Parameters

###### ref

`` `screen:${number},${number},${number},${number}@${number}` ``

##### Returns

`ScreenLocator`

##### Inherited from

`TerminalHarness.locatorForRef`

#### Call Signature

> **locatorForRef**(`ref`): `SemanticLocator` \| `ScreenLocator`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:212

##### Parameters

###### ref

`LocatorRef`

##### Returns

`SemanticLocator` \| `ScreenLocator`

##### Inherited from

`TerminalHarness.locatorForRef`

***

### ownedProcessResources()

> **ownedProcessResources**(): `OwnedProcessResourceUsage` \| `null`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:260

Native whole-tree accounting captured immediately before PTY disposal.
Returns `null` when the backend cannot make an authoritative claim.

#### Returns

`OwnedProcessResourceUsage` \| `null`

#### Inherited from

`TerminalHarness.ownedProcessResources`

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:215

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:213

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.press`

***

### renderError()

> **renderError**(): `Error` \| `null`

Defined in: [ink/src/mount.tsx:109](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/mount.tsx#L109)

The error a component threw during render, or `null`.

Set by the error boundary `mountInk` installs around the tree. It survives
until the next [InkHarness.rerender](#rerender).

#### Returns

`Error` \| `null`

***

### rerender()

> **rerender**(`element`, `opts?`): `Promise`\<`void`\>

Defined in: [ink/src/mount.tsx:101](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/mount.tsx#L101)

Replaces the mounted element and resolves once the resulting frame has been
committed and published — the component-test equivalent of a prop update.

The wrapper and the error boundary are re-applied, and the boundary is
reset, so a rerender can recover from a crash.

#### Parameters

##### element

`ReactNode`

##### opts?

[`SettleOptions`](../settleoptions/)

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<`ResizeReceipt`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:217

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:187

#### Returns

`ScreenSnapshot`

#### Inherited from

`TerminalHarness.screen`

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: driver/dist/session-Bg0dDZp-.d.ts:188

#### Returns

`SemanticSnapshot` \| `null`

#### Inherited from

`TerminalHarness.semanticTree`

***

### settled()

> **settled**(`opts?`): `Promise`\<`EffectiveSessionContract`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:186

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:221

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:233

#### Returns

`string`

#### Inherited from

`TerminalHarness.title`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:214

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:161

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:170

Waits until currently observable parser work, semantic frame pairing and
provider-evidence invalidation have committed. This cannot predict a
future semantic frame before either of its causal signals reaches the
driver, and it is not a quiet/global-idle heuristic.

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:232

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:227

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:223

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:231

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:222

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

Defined in: driver/dist/session-Bg0dDZp-.d.ts:234

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

### waitUntil()

> **waitUntil**\<`T`\>(`observe`, `options`): `Promise`\<`T`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:176

Re-evaluates user state only at committed terminal observation boundaries.
The check is armed before each read, so a change cannot land between the
predicate and its subscription. The last value is retained on timeout.

#### Type Parameters

##### T

`T`

#### Parameters

##### observe

(`observation`) => `T` \| `Promise`\<`T`\>

##### options

`WaitUntilOptions`\<`T`\>

#### Returns

`Promise`\<`T`\>

#### Inherited from

`TerminalHarness.waitUntil`

***

### write()

> **write**(`bytes`): `Promise`\<`void`\>

Defined in: driver/dist/session-Bg0dDZp-.d.ts:216

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>

#### Inherited from

`TerminalHarness.write`
