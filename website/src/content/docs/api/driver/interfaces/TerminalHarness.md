---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: [driver/src/api.ts:153](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L153)

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

Defined in: [driver/src/api.ts:238](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L238)

***

### exit

> `readonly` **exit**: `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [driver/src/api.ts:263](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L263)

***

### keyboard

> `readonly` **keyboard**: [`Keyboard`](../keyboard/)

Defined in: [driver/src/api.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L160)

One physical keyboard implementation. Convenience methods delegate here.

***

### mouse

> `readonly` **mouse**: [`Mouse`](../mouse/)

Defined in: [driver/src/api.ts:162](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L162)

One physical mouse implementation. Locator actions delegate here after planning.

***

### scrollback

> `readonly` **scrollback**: [`ScrollbackApi`](../scrollbackapi/)

Defined in: [driver/src/api.ts:234](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L234)

***

### selection

> `readonly` **selection**: [`SelectionApi`](../selectionapi/)

Defined in: [driver/src/api.ts:235](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L235)

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [driver/src/api.ts:154](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L154)

***

### shell

> `readonly` **shell**: [`ShellApi`](../shellapi/)

Defined in: [driver/src/api.ts:158](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L158)

Shell command boundaries and prompt state when the child emits OSC 133.

***

### terminalProfile

> `readonly` **terminalProfile**: `string`

Defined in: [driver/src/api.ts:156](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L156)

Immutable terminal profile used to decode the very first PTY byte.

***

### terminalState

> `readonly` **terminalState**: [`TerminalState`](../terminalstate/)

Defined in: [driver/src/api.ts:166](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L166)

Emulator facts captured together at the current screen revision.

***

### window

> `readonly` **window**: [`TerminalWindow`](../terminalwindow/)

Defined in: [driver/src/api.ts:164](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L164)

Terminal-window focus reports, distinct from semantic element focus.

## Methods

### appLogs()

> **appLogs**(): readonly [`AppLogEvent`](../applogevent/)[]

Defined in: [driver/src/api.ts:252](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L252)

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly [`AppLogEvent`](../applogevent/)[]

***

### bindOperationBudget()?

> `optional` **bindOperationBudget**(`budget`): `void`

Defined in: [driver/src/api.ts:168](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L168)

Binds one attempt-wide budget before any user operation starts.

#### Parameters

##### budget

[`OperationBudget`](../operationbudget/)

#### Returns

`void`

***

### cell()

> **cell**(`pos`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:192](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L192)

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

Defined in: [driver/src/api.ts:173](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L173)

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

[`ObservationStamp`](../observationstamp/)

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:262](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L262)

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### contract()

> **contract**(): [`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

Defined in: [driver/src/api.ts:171](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L171)

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

[`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

***

### crashReport()

> **crashReport**(): [`CrashReport`](../crashreport/) \| `null`

Defined in: [driver/src/api.ts:259](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L259)

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

[`CrashReport`](../crashreport/) \| `null`

***

### diagnostics()

> **diagnostics**(): readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

Defined in: [driver/src/api.ts:245](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L245)

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:196](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L196)

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

Defined in: [driver/src/api.ts:195](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L195)

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

Defined in: [driver/src/api.ts:200](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L200)

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

Defined in: [driver/src/api.ts:201](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L201)

#### Parameters

##### testId

`string`

#### Returns

[`SemanticLocator`](../semanticlocator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`SemanticLocator`](../semanticlocator/)

Defined in: [driver/src/api.ts:198](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L198)

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

Defined in: [driver/src/api.ts:203](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L203)

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

Defined in: [driver/src/api.ts:210](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L210)

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

Defined in: [driver/src/api.ts:211](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L211)

##### Parameters

###### ref

`` `screen:${number},${number},${number},${number}@${number}` ``

##### Returns

[`ScreenLocator`](../screenlocator/)

#### Call Signature

> **locatorForRef**(`ref`): [`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

Defined in: [driver/src/api.ts:212](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L212)

##### Parameters

###### ref

[`LocatorRef`](../../type-aliases/locatorref/)

##### Returns

[`SemanticLocator`](../semanticlocator/) \| [`ScreenLocator`](../screenlocator/)

***

### paste()

> **paste**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:217](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L217)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:215](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L215)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<[`ResizeReceipt`](../resizereceipt/)\>

Defined in: [driver/src/api.ts:219](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L219)

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

Defined in: [driver/src/api.ts:190](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L190)

#### Returns

[`ScreenSnapshot`](../screensnapshot/)

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: [driver/src/api.ts:191](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L191)

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<[`EffectiveSessionContract`](../effectivesessioncontract/)\>

Defined in: [driver/src/api.ts:189](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L189)

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

Defined in: [driver/src/api.ts:220](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L220)

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: [driver/src/api.ts:230](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L230)

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:216](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L216)

#### Parameters

##### text

[`ExecutableValue`](../../type-aliases/executablevalue/)

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:175](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L175)

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ObservationStamp`](../observationstamp/)\>

***

### waitForCommittedObservation()

> **waitForCommittedObservation**(`opts?`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:184](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L184)

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

Defined in: [driver/src/api.ts:229](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L229)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ExitStatus`](../exitstatus/)\>

***

### waitForQuiet()

> **waitForQuiet**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:226](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L226)

Heuristic only: waits for a stated interval with no screen or semantic change.

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForRender()

> **waitForRender**(`opts`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:224](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L224)

#### Parameters

##### opts

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForShellPrompt()

> **waitForShellPrompt**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:228](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L228)

Authoritative: waits for an OSC 133 prompt marker from shell integration.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:223](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L223)

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

Defined in: [driver/src/api.ts:231](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L231)

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

Defined in: [driver/src/api.ts:218](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L218)

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
