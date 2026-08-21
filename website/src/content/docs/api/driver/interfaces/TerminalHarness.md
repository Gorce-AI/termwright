---
title: "Interface: TerminalHarness"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TerminalHarness

# Interface: TerminalHarness

Defined in: [driver/src/api.ts:125](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L125)

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

Defined in: [driver/src/api.ts:204](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L204)

***

### exit

> `readonly` **exit**: `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [driver/src/api.ts:229](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L229)

***

### keyboard

> `readonly` **keyboard**: [`Keyboard`](../keyboard/)

Defined in: [driver/src/api.ts:130](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L130)

One physical keyboard implementation. Convenience methods delegate here.

***

### mouse

> `readonly` **mouse**: [`Mouse`](../mouse/)

Defined in: [driver/src/api.ts:132](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L132)

One physical mouse implementation. Locator actions delegate here after planning.

***

### scrollback

> `readonly` **scrollback**: [`ScrollbackApi`](../scrollbackapi/)

Defined in: [driver/src/api.ts:200](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L200)

***

### selection

> `readonly` **selection**: [`SelectionApi`](../selectionapi/)

Defined in: [driver/src/api.ts:201](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L201)

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [driver/src/api.ts:126](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L126)

***

### shell

> `readonly` **shell**: [`ShellApi`](../shellapi/)

Defined in: [driver/src/api.ts:128](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L128)

Shell command boundaries and prompt state when the child emits OSC 133.

***

### terminalState

> `readonly` **terminalState**: [`TerminalState`](../terminalstate/)

Defined in: [driver/src/api.ts:136](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L136)

Emulator facts captured together at the current screen revision.

***

### window

> `readonly` **window**: [`TerminalWindow`](../terminalwindow/)

Defined in: [driver/src/api.ts:134](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L134)

Terminal-window focus reports, distinct from semantic element focus.

## Methods

### appLogs()

> **appLogs**(): readonly [`AppLogEvent`](../applogevent/)[]

Defined in: [driver/src/api.ts:218](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L218)

Bounded, oldest-first application-log history, including entries emitted
while `launchTerminal()` was still starting. Consumers should subscribe to
`app-log` first and then seed from this snapshot to avoid a startup gap.

#### Returns

readonly [`AppLogEvent`](../applogevent/)[]

***

### capabilities()

> **capabilities**(): [`SessionCapabilities`](../sessioncapabilities/)

Defined in: [driver/src/api.ts:138](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L138)

#### Returns

[`SessionCapabilities`](../sessioncapabilities/)

***

### cell()

> **cell**(`pos`): [`CellSnapshot`](../cellsnapshot/)

Defined in: [driver/src/api.ts:156](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L156)

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

Defined in: [driver/src/api.ts:142](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L142)

Atomic identity of the currently committed terminal/semantic observation.

#### Returns

[`ObservationStamp`](../observationstamp/)

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:228](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L228)

Idempotent; bounded physical cleanup. Never sends signals implicitly.

#### Returns

`Promise`\<`void`\>

***

### contract()

> **contract**(): [`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

Defined in: [driver/src/api.ts:140](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L140)

Frozen negotiated contract, or null until negotiation has completed.

#### Returns

[`EffectiveSessionContract`](../effectivesessioncontract/) \| `null`

***

### crashReport()

> **crashReport**(): [`CrashReport`](../crashreport/) \| `null`

Defined in: [driver/src/api.ts:225](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L225)

What the session knew when the program died unexpectedly, or `null` — for a
live session, a clean exit, or one the harness asked for via `close()` or
`signal()`. Available as soon as the `exit` event fires.

#### Returns

[`CrashReport`](../crashreport/) \| `null`

***

### diagnostics()

> **diagnostics**(): readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

Defined in: [driver/src/api.ts:211](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L211)

Bounded, oldest-first log of what the session decided behind the scenes:
dropped or superseded revisions, unverified markers, adapter negotiation,
protocol violations. The same entries are emitted as `diagnostic` events.

#### Returns

readonly [`SessionDiagnostic`](../sessiondiagnostic/)[]

***

### getByLabel()

> **getByLabel**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L160)

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

Defined in: [driver/src/api.ts:159](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L159)

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

Defined in: [driver/src/api.ts:164](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L164)

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

Defined in: [driver/src/api.ts:165](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L165)

#### Parameters

##### testId

`string`

#### Returns

[`Locator`](../locator/)

***

### getByText()

> **getByText**(`text`, `opts?`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:162](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L162)

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

Defined in: [driver/src/api.ts:167](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L167)

Advanced Termwright semantic selector: 'dialog button.primary:focused', '#id'.

#### Parameters

##### selector

`string`

#### Returns

[`Locator`](../locator/)

***

### locatorForRef()

> **locatorForRef**(`ref`): [`Locator`](../locator/)

Defined in: [driver/src/api.ts:174](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L174)

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

Defined in: [driver/src/api.ts:179](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L179)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`keys`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:177](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L177)

#### Parameters

##### keys

`string`

#### Returns

`Promise`\<`void`\>

***

### resize()

> **resize**(`size`): `Promise`\<[`ResizeReceipt`](../resizereceipt/)\>

Defined in: [driver/src/api.ts:181](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L181)

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

Defined in: [driver/src/api.ts:154](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L154)

#### Returns

[`ScreenSnapshot`](../screensnapshot/)

***

### semanticTree()

> **semanticTree**(): `SemanticSnapshot` \| `null`

Defined in: [driver/src/api.ts:155](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L155)

#### Returns

`SemanticSnapshot` \| `null`

***

### settled()

> **settled**(`opts?`): `Promise`\<[`EffectiveSessionContract`](../effectivesessioncontract/)\>

Defined in: [driver/src/api.ts:153](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L153)

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

Defined in: [driver/src/api.ts:182](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L182)

#### Parameters

##### sig

`"INT"` \| `"TERM"` \| `"KILL"` \| `"HUP"`

#### Returns

`Promise`\<`void`\>

***

### title()

> **title**(): `string`

Defined in: [driver/src/api.ts:196](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L196)

#### Returns

`string`

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:178](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L178)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>

***

### waitForCheckpointChange()

> **waitForCheckpointChange**(`options`): `Promise`\<[`ObservationStamp`](../observationstamp/)\>

Defined in: [driver/src/api.ts:144](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L144)

Wait until a committed observation newer than `after` is available.

#### Parameters

##### options

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ObservationStamp`](../observationstamp/)\>

***

### waitForExit()

> **waitForExit**(`opts?`): `Promise`\<[`ExitStatus`](../exitstatus/)\>

Defined in: [driver/src/api.ts:195](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L195)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<[`ExitStatus`](../exitstatus/)\>

***

### waitForIdle()

> **waitForIdle**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:188](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L188)

#### Parameters

##### opts?

[`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForReady()

> **waitForReady**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:194](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L194)

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

Defined in: [driver/src/api.ts:186](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L186)

#### Parameters

##### opts

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForStable()

> **waitForStable**(`opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:187](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L187)

#### Parameters

##### opts?

`object` & [`WaitOptions`](../waitoptions/)

#### Returns

`Promise`\<`void`\>

***

### waitForText()

> **waitForText**(`text`, `opts?`): `Promise`\<`void`\>

Defined in: [driver/src/api.ts:185](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L185)

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

Defined in: [driver/src/api.ts:197](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L197)

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

Defined in: [driver/src/api.ts:180](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L180)

#### Parameters

##### bytes

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
