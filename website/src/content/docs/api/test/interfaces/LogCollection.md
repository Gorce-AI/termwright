---
title: "Interface: LogCollection"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / LogCollection

# Interface: LogCollection

Defined in: [test/src/logs.ts:42](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L42)

Everything a test can ask of its logs.

## Methods

### all()

> **all**(): readonly [`CapturedLog`](../capturedlog/)[]

Defined in: [test/src/logs.ts:44](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L44)

Every entry, oldest first.

#### Returns

readonly [`CapturedLog`](../capturedlog/)[]

***

### clear()

> **clear**(): `void`

Defined in: [test/src/logs.ts:53](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L53)

Forgets everything captured so far.

#### Returns

`void`

***

### dropped()

> **dropped**(): `number`

Defined in: [test/src/logs.ts:55](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L55)

Entries dropped after this collection reached its bounded capacity.

#### Returns

`number`

***

### filter()

> **filter**(`query?`): readonly [`CapturedLog`](../capturedlog/)[]

Defined in: [test/src/logs.ts:46](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L46)

The entries a query selects, oldest first.

#### Parameters

##### query?

[`LogQuery`](../logquery/)

#### Returns

readonly [`CapturedLog`](../capturedlog/)[]

***

### lostRecords()

> **lostRecords**(): `number`

Defined in: [test/src/logs.ts:63](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L63)

Log entries that never reached this test: the sum of `count` over the
session's `log-dropped` diagnostics.

A refused duplicate carries no `count` and is not counted — it was not a
loss, since the record it repeated did arrive.

#### Returns

`number`

***

### noteLostRecords()

> **noteLostRecords**(`count`): `void`

Defined in: [test/src/logs.ts:67](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L67)

Adds to [lostRecords](#lostrecords). Used by [collectLogs](../../functions/collectlogs/).

#### Parameters

##### count

`number`

#### Returns

`void`

***

### push()

> **push**(`entry`): `void`

Defined in: [test/src/logs.ts:65](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L65)

Appends an entry. Used by the fixtures; tests read rather than write.

#### Parameters

##### entry

[`CapturedLog`](../capturedlog/)

#### Returns

`void`

***

### revision()

> **revision**(): `number`

Defined in: [test/src/logs.ts:69](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L69)

Monotonic collection revision for race-free matcher waits.

#### Returns

`number`

***

### text()

> **text**(`query?`): `string`

Defined in: [test/src/logs.ts:51](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L51)

Entries rendered one per line, without timestamps, sequence numbers or
revisions — stable enough to put in a snapshot.

#### Parameters

##### query?

[`LogQuery`](../logquery/)

#### Returns

`string`

***

### waitForChange()

> **waitForChange**(`after`, `timeout`): `Promise`\<`void`\>

Defined in: [test/src/logs.ts:71](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L71)

Arms first, then checks whether `after` was already superseded.

#### Parameters

##### after

`number`

##### timeout

`number`

#### Returns

`Promise`\<`void`\>
