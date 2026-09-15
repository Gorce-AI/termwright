---
title: "Class: VtScreen"
editUrl: false
pagefind: false
---

[**@termwright/driver/experimental**](../../)

***

[@termwright/driver/experimental](../../) / VtScreen

# Class: VtScreen

Defined in: [vt.ts:165](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L165)

A headless terminal with a serialized write queue and a monotonically
increasing screen revision. One instance per session.

## Constructors

### Constructor

> **new VtScreen**(`options`): `VtScreen`

Defined in: [vt.ts:215](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L215)

#### Parameters

##### options

`VtOptions`

#### Returns

`VtScreen`

## Properties

### profile

> `readonly` **profile**: `TerminalProfile`

Defined in: [vt.ts:168](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L168)

The profile this emulator counts characters with.

***

### terminal

> `readonly` **terminal**: `Terminal`

Defined in: [vt.ts:166](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L166)

## Accessors

### columns

#### Get Signature

> **get** **columns**(): `number`

Defined in: [vt.ts:270](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L270)

##### Returns

`number`

***

### hasPendingWrite

#### Get Signature

> **get** **hasPendingWrite**(): `boolean`

Defined in: [vt.ts:251](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L251)

True from enqueue until the callback of the final queued VT write.

##### Returns

`boolean`

***

### isCaughtUp

#### Get Signature

> **get** **isCaughtUp**(): `boolean`

Defined in: [vt.ts:256](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L256)

Whether every VT write enqueued so far has reached its parse callback.

##### Returns

`boolean`

***

### retainedFloor

#### Get Signature

> **get** **retainedFloor**(): `number`

Defined in: [vt.ts:266](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L266)

Number of scrollback lines evicted since the session started.

##### Returns

`number`

***

### revision

#### Get Signature

> **get** **revision**(): `number`

Defined in: [vt.ts:246](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L246)

Current screen revision; incremented once per observable VT state change.

##### Returns

`number`

***

### rows

#### Get Signature

> **get** **rows**(): `number`

Defined in: [vt.ts:274](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L274)

##### Returns

`number`

***

### title

#### Get Signature

> **get** **title**(): `string`

Defined in: [vt.ts:261](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L261)

Window title as last set by OSC 0/2.

##### Returns

`string`

## Methods

### activeBuffer()

> **activeBuffer**(): `"normal"` \| `"alternate"`

Defined in: [vt.ts:382](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L382)

Which xterm buffer currently backs the visible viewport.

#### Returns

`"normal"` \| `"alternate"`

***

### allLines()

> **allLines**(): `string`[]

Defined in: [vt.ts:324](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L324)

Every retained line, scrollback first, as text.

#### Returns

`string`[]

***

### cursor()

> **cursor**(): `CursorInfo`

Defined in: [vt.ts:371](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L371)

Cursor position (viewport-relative), visibility and shape.

#### Returns

`CursorInfo`

***

### dispose()

> **dispose**(): `void`

Defined in: [vt.ts:481](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L481)

#### Returns

`void`

***

### drain()

> **drain**(): `Promise`\<`void`\>

Defined in: [vt.ts:319](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L319)

Resolves once every write issued so far has been parsed. A child's dying
output — a stack trace, a panic — is usually still in flight when the pty
reports the exit, so anything that reads the screen at that moment must
drain first or it reads a screen from before the crash.

#### Returns

`Promise`\<`void`\>

***

### modes()

> **modes**(): `TerminalModes`

Defined in: [vt.ts:351](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L351)

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

Defined in: [vt.ts:465](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L465)

#### Parameters

##### cb

(`marker`) => `void`

#### Returns

`Unsubscribe`

***

### onResponse()

> **onResponse**(`cb`): `Unsubscribe`

Defined in: [vt.ts:476](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L476)

Receives terminal protocol replies which the session must return to the child.

#### Parameters

##### cb

(`response`) => `void`

#### Returns

`Unsubscribe`

***

### onRevision()

> **onRevision**(`cb`): `Unsubscribe`

Defined in: [vt.ts:408](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L408)

#### Parameters

##### cb

(`revision`) => `void`

#### Returns

`Unsubscribe`

***

### onTitle()

> **onTitle**(`cb`): `Unsubscribe`

Defined in: [vt.ts:470](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L470)

#### Parameters

##### cb

(`title`) => `void`

#### Returns

`Unsubscribe`

***

### regionChangeSince()

> **regionChangeSince**(`revision`, `spans`): `RegionChange`

Defined in: [vt.ts:437](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L437)

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

Defined in: [vt.ts:420](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L420)

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

Defined in: [vt.ts:334](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L334)

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

Defined in: [vt.ts:399](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L399)

ANSI serialization of the visible grid (addon-serialize).

#### Parameters

##### scrollback?

`number` = `0`

#### Returns

`string`

***

### serializeHtml()

> **serializeHtml**(`scrollback?`): `string`

Defined in: [vt.ts:404](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L404)

HTML serialization of the visible grid (addon-serialize).

#### Parameters

##### scrollback?

`number` = `0`

#### Returns

`string`

***

### shellIntegration()

> **shellIntegration**(): `ShellIntegration`

Defined in: [vt.ts:387](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L387)

Prompt state as reported by OSC 133, if the program reports it at all.

#### Returns

`ShellIntegration`

***

### write()

> **write**(`data`): `Promise`\<`void`\>

Defined in: [vt.ts:282](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/vt.ts#L282)

Feeds bytes to the emulator and resolves once they have been parsed and the
resulting revision published. Writes are serialized in call order.

#### Parameters

##### data

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

#### Returns

`Promise`\<`void`\>
