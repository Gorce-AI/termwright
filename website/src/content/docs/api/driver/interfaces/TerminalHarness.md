---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: [driver/src/api.ts:193](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L193)

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

### artifactSecurity

> `readonly` **artifactSecurity**: `ResolvedArtifactSecurityPolicy`

Defined in: [driver/src/api.ts:196](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L196)

Resolved policy inherited by traces, reports and other artifact sinks.

***

### events

> `readonly` **events**: [`SessionEvents`](../sessionevents/)

Defined in: [driver/src/api.ts:294](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L294)

***

### exit

> `readonly` **exit**: `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [driver/src/api.ts:325](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L325)

***

### keyboard

> `readonly` **keyboard**: [`Keyboard`](../keyboard/)

Defined in: [driver/src/api.ts:202](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L202)

One physical keyboard implementation. Convenience methods delegate here.

***

### mouse

> `readonly` **mouse**: [`Mouse`](../mouse/)

Defined in: [driver/src/api.ts:204](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L204)

One physical mouse implementation. Locator actions delegate here after planning.

***

### scrollback

> `readonly` **scrollback**: [`ScrollbackApi`](../scrollbackapi/)

Defined in: [driver/src/api.ts:290](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L290)

***

### selection

> `readonly` **selection**: [`SelectionApi`](../selectionapi/)

Defined in: [driver/src/api.ts:291](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L291)

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [driver/src/api.ts:194](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L194)

***

### shell

> `readonly` **shell**: [`ShellApi`](../shellapi/)

Defined in: [driver/src/api.ts:200](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L200)

Shell command boundaries and prompt state when the child emits OSC 133.

***

### terminalProfile

> `readonly` **terminalProfile**: [`TerminalProfileId`](../../type-aliases/terminalprofileid/)

Defined in: [driver/src/api.ts:198](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L198)

Immutable terminal profile used to decode the very first PTY byte.

***

### terminalState

> `readonly` **terminalState**: [`TerminalState`](../terminalstate/)

Defined in: [driver/src/api.ts:208](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L208)

Emulator facts captured together at the current screen revision.

***

### window

> `readonly` **window**: [`TerminalWindow`](../terminalwindow/)

Defined in: [driver/src/api.ts:206](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L206)

Terminal-window focus reports, distinct from semantic element focus.

## Methods

### appLogs()

> **appLogs**(): readonly [`AppLogEvent`](../applogevent/)[]

Defined in: [driver/src/api.ts:308](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L308)

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly [`AppLogEvent`](../applogevent/)[]

***

### bindOperationBudget()?

> `optional` **bindOperationBudget**(`budget`): `void`

Defined in: [driver/src/api.ts:210](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L210)

Binds one attempt-wide budget before any user operation starts.

#### Parameters

##### budget

[`OperationBudget`](../operationbudget/)

#### Returns

`void`

***

### cell()

> **cell**(`pos`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:248](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L248)

#### Parameters

##### pos

###### column

`number`

###### row

`number`

#### Returns

[`CellSnapshot`](../cellsnapshot/)

***

### checkpoint()

> **checkpoint**(): [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:215](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L215)

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

[`ObservationStamp`](../observationstamp/)

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:324](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L324)

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### contract()

> **contract**(): [`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

Defined in: [driver/src/api.ts:213](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L213)

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

[`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

***

### crashReport()

> **crashReport**(): [`CrashReport`](../crashreport/) \| `null`

Defined in: [driver/src/api.ts:315](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L315)

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

[`CrashReport`](../crashreport/) \| `null`

***

### diagnostics()

> **diagnostics**(): readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

Defined in: [driver/src/api.ts:301](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L301)

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

***

### focusByTraversal()

> **focusByTraversal**(`target`, `options?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:240](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L240)

Reaches a semantic target through the application's real keyboard focus
ring. Every key is followed by a committed focus change before continuing.

#### Parameters

##### target

[`SemanticLocator`](../semanticlocator/)

##### options?

[`FocusTraversalOptions`](../focustraversaloptions/)

#### Returns

`Promise`\<`void`\>

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:252](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L252)

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

Defined in: [driver/src/api.ts:251](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L251)

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

[`RoleLocatorOptions`](../rolelocatoroptions/)

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): [`ScreenLocator`](../screenlocator/)

Defined in: [driver/src/api.ts:256](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L256)

Physical terminal-grid text, optionally narrowed by occurrence or style.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`ScreenTextLocatorOptions`](../screentextlocatoroptions/)

#### Returns

[`ScreenLocator`](../screenlocator/)

***

### getByTestId()

> **getByTestId**(`testId`): [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:257](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L257)

#### Parameters

##### testId

`string`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:254](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L254)

Semantic text only. Never falls back to the terminal grid.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`TextLocatorOptions`](../textlocatoroptions/)

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### locator()

> **locator**(`selector`): [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:259](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L259)

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

Defined in: [driver/src/api.ts:266](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L266)

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

Defined in: [driver/src/api.ts:267](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L267)

##### Parameters

###### ref

`` `screen:${number},${number},${number},${number}@${number}` ``

##### Returns

[`ScreenLocator`](../screenlocator/)

#### Call Signature

> **locatorForRef**(`ref`): [`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

Defined in: [driver/src/api.ts:268](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L268)

##### Parameters

###### ref

[`LocatorRef`](../../type-aliases/locatorref/)

##### Returns

[`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

***

### ownedProcessResources()

> **ownedProcessResources**(): [`OwnedProcessResourceUsage`](../ownedprocessresourceusage/) \| `null`

Defined in: [driver/src/api.ts:321](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L321)

Native whole-tree accounting captured immediately before PTY disposal.
Returns `null` when the backend cannot make an authoritative claim.

#### Returns

[`OwnedProcessResourceUsage`](../ownedprocessresourceusage/) \| `null`

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:273](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L273)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:271](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L271)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<[`ResizeReceipt`](../resizereceipt/)\>

Defined in: [driver/src/api.ts:275](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L275)

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

Defined in: [driver/src/api.ts:246](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L246)

#### Returns

[`ScreenSnapshot`](../screensnapshot/)

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: [driver/src/api.ts:247](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L247)

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<[`EffectiveSessionContract`](../effectivesessioncontract/)\>

Defined in: [driver/src/api.ts:245](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L245)

Waits for the one frozen Effective Session Contract and, for a semantic
session, for the first paired tree. There is no provisional capability API.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`EffectiveSessionContract`](../effectivesessioncontract/)\>

***

### signal()

> **signal**(`sig`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:276](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L276)

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: [driver/src/api.ts:286](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L286)

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:272](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L272)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:217](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L217)

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ObservationStamp`](../observationstamp/)\>

***

### waitForCommittedObservation()

> **waitForCommittedObservation**(`opts?`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:226](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L226)

Waits until currently observable parser work, semantic frame pairing and
provider-evidence invalidation have committed. This cannot predict a
future semantic frame before either of its causal signals reaches the
driver, and it is not a quiet/global-idle heuristic.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ObservationStamp`](../observationstamp/)\>

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [driver/src/api.ts:285](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L285)

#### Parameters

##### opts?

[`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<[`ExitStatus`](../exitstatus/)\>

***

### waitForQuiet()

> **waitForQuiet**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:282](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L282)

Heuristic only: waits for a stated interval with no screen or semantic change.

#### Parameters

##### opts?

`object` & [`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:280](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L280)

#### Parameters

##### opts

`object` & [`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForShellPrompt()

> **waitForShellPrompt**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:284](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L284)

Authoritative: waits for an OSC 133 prompt marker from shell integration.

#### Parameters

##### opts?

[`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:279](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L279)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForTitle()

> **waitForTitle**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:287](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L287)

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`AbortableWaitOptions`](../abortablewaitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitUntil()

> **waitUntil**\<`T`\>(`observe`, `options`): `Promise`\<`T`\>

Defined in: [driver/src/api.ts:232](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L232)

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

[`WaitUntilOptions`](../waituntiloptions/)\<`T`\>

#### Returns

`Promise`\<`T`\>

***

### write()

> **write**(`bytes`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:274](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L274)

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
