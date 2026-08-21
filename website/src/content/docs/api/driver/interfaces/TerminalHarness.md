---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: [driver/src/api.ts:120](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L120)

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

Defined in: [driver/src/api.ts:199](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L199)

***

### exit

> `readonly` **exit**: `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [driver/src/api.ts:224](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L224)

***

### keyboard

> `readonly` **keyboard**: [`Keyboard`](../keyboard/)

Defined in: [driver/src/api.ts:125](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L125)

One physical keyboard implementation. Convenience methods delegate here.

***

### mouse

> `readonly` **mouse**: [`Mouse`](../mouse/)

Defined in: [driver/src/api.ts:127](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L127)

One physical mouse implementation. Locator actions delegate here after planning.

***

### scrollback

> `readonly` **scrollback**: [`ScrollbackApi`](../scrollbackapi/)

Defined in: [driver/src/api.ts:195](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L195)

***

### selection

> `readonly` **selection**: [`SelectionApi`](../selectionapi/)

Defined in: [driver/src/api.ts:196](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L196)

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [driver/src/api.ts:121](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L121)

***

### shell

> `readonly` **shell**: [`ShellApi`](../shellapi/)

Defined in: [driver/src/api.ts:123](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L123)

Shell command boundaries and prompt state when the child emits OSC 133.

***

### terminalState

> `readonly` **terminalState**: [`TerminalState`](../terminalstate/)

Defined in: [driver/src/api.ts:131](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L131)

Emulator facts captured together at the current screen revision.

***

### window

> `readonly` **window**: [`TerminalWindow`](../terminalwindow/)

Defined in: [driver/src/api.ts:129](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L129)

Terminal-window focus reports, distinct from semantic element focus.

## Methods

### appLogs()

> **appLogs**(): readonly [`AppLogEvent`](../applogevent/)[]

Defined in: [driver/src/api.ts:213](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L213)

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly [`AppLogEvent`](../applogevent/)[]

***

### capabilities()

> **capabilities**(): [`SessionCapabilities`](../sessioncapabilities/)

Defined in: [driver/src/api.ts:133](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L133)

#### Returns

[`SessionCapabilities`](../sessioncapabilities/)

***

### cell()

> **cell**(`pos`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:151](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L151)

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

Defined in: [driver/src/api.ts:137](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L137)

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

[`ObservationStamp`](../observationstamp/)

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:223](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L223)

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### contract()

> **contract**(): [`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

Defined in: [driver/src/api.ts:135](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L135)

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

[`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

***

### crashReport()

> **crashReport**(): [`CrashReport`](../crashreport/) \| `null`

Defined in: [driver/src/api.ts:220](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L220)

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

[`CrashReport`](../crashreport/) \| `null`

***

### diagnostics()

> **diagnostics**(): readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

Defined in: [driver/src/api.ts:206](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L206)

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:155](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L155)

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

Defined in: [driver/src/api.ts:154](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L154)

#### Parameters

##### role

`"application"` \| `"region"` \| `"dialog"` \| `"alert"` \| `"status"` \| `"list"` \| `"listitem"` \| `"menu"` \| `"menuitem"` \| `"button"` \| `"checkbox"` \| `"radio"` \| `"tab"` \| `"textbox"` \| `"heading"` \| `"text"` \| `"progressbar"` \| `"separator"` \| `"scrollbar"` \| `"table"` \| `"row"` \| `"cell"` \| `"generic"`

##### opts?

[`RoleLocatorOptions`](../rolelocatoroptions/)

#### Returns

[`Locator`](../locator/)

***

### getByScreenText()

> **getByScreenText**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:159](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L159)

Physical terminal-grid text, optionally narrowed by occurrence or style.

#### Parameters

##### text

`string` \| `RegExp`

##### opts?

[`ScreenTextLocatorOptions`](../screentextlocatoroptions/)

#### Returns

[`Locator`](../locator/)

***

### getByTestId()

> **getByTestId**(`testId`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L160)

#### Parameters

##### testId

`string`

#### Returns

[`Locator`](../locator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:157](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L157)

Semantic text only. Never falls back to the terminal grid.

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

Defined in: [driver/src/api.ts:162](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L162)

Advanced Termwright semantic selector: 'dialog button.primary:focused', '#id'.

#### Parameters

##### selector

`string`

#### Returns

[`Locator`](../locator/)

***

### locatorForRef()

> **locatorForRef**(`ref`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:169](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L169)

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

Defined in: [driver/src/api.ts:174](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L174)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:172](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L172)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<[`ResizeReceipt`](../resizereceipt/)\>

Defined in: [driver/src/api.ts:176](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L176)

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

Defined in: [driver/src/api.ts:149](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L149)

#### Returns

[`ScreenSnapshot`](../screensnapshot/)

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: [driver/src/api.ts:150](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L150)

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<[`EffectiveSessionContract`](../effectivesessioncontract/)\>

Defined in: [driver/src/api.ts:148](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L148)

The capabilities, once they are final.

`capabilities()` answers immediately with what is known so far, which is
what a synchronous caller needs. This waits for the negotiation to reach
its verdict and, for a semantic session, for the first tree to be published. After it resolves,
`semanticTree` will not change again.

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`EffectiveSessionContract`](../effectivesessioncontract/)\>

***

### signal()

> **signal**(`sig`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:177](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L177)

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: [driver/src/api.ts:191](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L191)

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:173](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L173)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:139](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L139)

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ObservationStamp`](../observationstamp/)\>

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [driver/src/api.ts:190](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L190)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ExitStatus`](../exitstatus/)\>

***

### waitForIdle()

> **waitForIdle**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:183](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L183)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForReady()

> **waitForReady**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:189](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L189)

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

Defined in: [driver/src/api.ts:181](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L181)

#### Parameters

##### opts

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForStable()

> **waitForStable**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:182](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L182)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:180](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L180)

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

Defined in: [driver/src/api.ts:192](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L192)

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

Defined in: [driver/src/api.ts:175](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L175)

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
