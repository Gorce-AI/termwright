---
title: "Class: VtScreen"
editUrl: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / VtScreen

# Class: VtScreen

Defined in: [vt.ts:160](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L160)

A headless terminal with a serialized write queue and a monotonically
increasing screen revision. One instance per session.

## Constructors

### Constructor

> **new VtScreen**(`options`): `VtScreen`

Defined in: [vt.ts:206](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L206)

#### Parameters

##### options

`VtOptions`

#### Returns

`VtScreen`

## Properties

### profile

> `readonly` **profile**: `TerminalProfile`

Defined in: [vt.ts:163](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L163)

The profile this emulator counts characters with.

***

### terminal

> `readonly` **terminal**: `Terminal`

Defined in: [vt.ts:161](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L161)

## Accessors

### columns

#### Get Signature

> **get** **columns**(): `number`

Defined in: [vt.ts:261](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L261)

##### Returns

`number`

***

### hasPendingWrite

#### Get Signature

> **get** **hasPendingWrite**(): `boolean`

Defined in: [vt.ts:242](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L242)

True from enqueue until the callback of the final queued VT write.

##### Returns

`boolean`

***

### isCaughtUp

#### Get Signature

> **get** **isCaughtUp**(): `boolean`

Defined in: [vt.ts:247](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L247)

Whether every VT write enqueued so far has reached its parse callback.

##### Returns

`boolean`

***

### retainedFloor

#### Get Signature

> **get** **retainedFloor**(): `number`

Defined in: [vt.ts:257](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L257)

Number of scrollback lines evicted since the session started.

##### Returns

`number`

***

### revision

#### Get Signature

> **get** **revision**(): `number`

Defined in: [vt.ts:237](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L237)

Current screen revision; incremented once per observable VT state change.

##### Returns

`number`

***

### rows

#### Get Signature

> **get** **rows**(): `number`

Defined in: [vt.ts:265](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L265)

##### Returns

`number`

***

### title

#### Get Signature

> **get** **title**(): `string`

Defined in: [vt.ts:252](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L252)

Window title as last set by OSC 0/2.

##### Returns

`string`

## Methods

### activeBuffer()

> **activeBuffer**(): `"normal"` \| `"alternate"`

Defined in: [vt.ts:372](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L372)

Which xterm buffer currently backs the visible viewport.

#### Returns

`"normal"` \| `"alternate"`

***

### allLines()

> **allLines**(): `string`[]

Defined in: [vt.ts:315](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L315)

Every retained line, scrollback first, as text.

#### Returns

`string`[]

***

### cursor()

> **cursor**(): `CursorInfo`

Defined in: [vt.ts:361](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L361)

Cursor position (viewport-relative), visibility and shape.

#### Returns

`CursorInfo`

***

### dispose()

> **dispose**(): `void`

Defined in: [vt.ts:471](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L471)

#### Returns

`void`

***

### drain()

> **drain**(): `Promise`\<`void`\>

Defined in: [vt.ts:310](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L310)

Resolves once every write issued so far has been parsed. A child's dying
output — a stack trace, a panic — is usually still in flight when the pty
reports the exit, so anything that reads the screen at that moment must
drain first or it reads a screen from before the crash.

#### Returns

`Promise`\<`void`\>

***

### modes()

> **modes**(): `TerminalModes`

Defined in: [vt.ts:342](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L342)

Input-relevant modes, merged from `Terminal.modes` and our own tracking.

Input modes read `'unknown'` only when an embedding explicitly declares
them unobservable. Reporting a definite value in that case would be a
claim the transport cannot support, so mode-gated actions fail closed.

The pinned passthrough ConPTY carries the same DECSET stream as POSIX PTYs,
including mouse, focus, bracketed-paste and alternate-screen modes.

#### Returns

`TerminalModes`

***

### onMarker()

> **onMarker**(`cb`): `Unsubscribe`

Defined in: [vt.ts:455](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L455)

#### Parameters

##### cb

(`marker`) => `void`

#### Returns

`Unsubscribe`

***

### onResponse()

> **onResponse**(`cb`): `Unsubscribe`

Defined in: [vt.ts:466](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L466)

Receives terminal protocol replies which the session must return to the child.

#### Parameters

##### cb

(`response`) => `void`

#### Returns

`Unsubscribe`

***

### onRevision()

> **onRevision**(`cb`): `Unsubscribe`

Defined in: [vt.ts:398](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L398)

#### Parameters

##### cb

(`revision`) => `void`

#### Returns

`Unsubscribe`

***

### onTitle()

> **onTitle**(`cb`): `Unsubscribe`

Defined in: [vt.ts:460](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L460)

#### Parameters

##### cb

(`title`) => `void`

#### Returns

`Unsubscribe`

***

### regionChangeSince()

> **regionChangeSince**(`revision`, `spans`): `RegionChange`

Defined in: [vt.ts:427](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L427)

Why a region is not usable at a past revision, or that it is.

The three answers call for different work and are indistinguishable from
the boolean. A coordinate system that moved invalidates every region at
once and says nothing about the target; cells that changed say the target
itself is different; a span outside the grid is a caller error. A stale
pointer that reports only "changed" sends the reader looking in the wrong
place, which on Windows it has.

#### Parameters

##### revision

`number`

##### spans

readonly `object`[]

#### Returns

`RegionChange`

***

### regionUnchangedSince()

> **regionUnchangedSince**(`revision`, `spans`): `boolean`

Defined in: [vt.ts:410](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L410)

Whether every cell in `spans` survived unchanged since `revision`.
Returns false when a resize/buffer/scroll changed the coordinate system.
This is the target-local counterpart of global
waitForQuiet(): an unrelated status bar may animate without invalidating
a button elsewhere on screen.

#### Parameters

##### revision

`number`

##### spans

readonly `object`[]

#### Returns

`boolean`

***

### resize()

> **resize**(`columns`, `rows`): `void`

Defined in: [vt.ts:325](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L325)

Resizes the emulator grid (the PTY is resized separately by the session).

#### Parameters

##### columns

`number`

##### rows

`number`

#### Returns

`void`

***

### serializeAnsi()

> **serializeAnsi**(`scrollback?`): `string`

Defined in: [vt.ts:389](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L389)

ANSI serialization of the visible grid (addon-serialize).

#### Parameters

##### scrollback?

`number` = `0`

#### Returns

`string`

***

### serializeHtml()

> **serializeHtml**(`scrollback?`): `string`

Defined in: [vt.ts:394](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L394)

HTML serialization of the visible grid (addon-serialize).

#### Parameters

##### scrollback?

`number` = `0`

#### Returns

`string`

***

### shellIntegration()

> **shellIntegration**(): `ShellIntegration`

Defined in: [vt.ts:377](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L377)

Prompt state as reported by OSC 133, if the program reports it at all.

#### Returns

`ShellIntegration`

***

### write()

> **write**(`data`): `Promise`\<`void`\>

Defined in: [vt.ts:273](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L273)

Feeds bytes to the emulator and resolves once they have been parsed and the
resulting revision published. Writes are serialized in call order.

#### Parameters

##### data

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
