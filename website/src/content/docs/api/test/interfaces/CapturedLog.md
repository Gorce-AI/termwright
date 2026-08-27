---
title: "Interface: CapturedLog"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / CapturedLog

# Interface: CapturedLog

Defined in: [test/src/logs.ts:15](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L15)

One log entry, tagged with the session that produced it.

## Extends

- `AppLogEvent`

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: driver/dist/session-uL1ytjek.d.ts:763

#### Inherited from

`AppLogEvent.label`

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: driver/dist/session-uL1ytjek.d.ts:770

Raw line, for a followed file. Truncated lines end with an ellipsis.

#### Inherited from

`AppLogEvent.line`

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: driver/dist/session-uL1ytjek.d.ts:768

Path of the followed file, for `source: 'file'`. A label can be short and
shared between sources; the path is what a reader opens.

#### Inherited from

`AppLogEvent.path`

***

### record?

> `readonly` `optional` **record?**: `LogRecord`

Defined in: driver/dist/session-uL1ytjek.d.ts:772

Structured record, for an adapter that negotiated the logs capability.

#### Inherited from

`AppLogEvent.record`

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [test/src/logs.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L16)

***

### source

> `readonly` **source**: `"file"` \| `"adapter"`

Defined in: driver/dist/session-uL1ytjek.d.ts:762

#### Inherited from

`AppLogEvent.source`

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: driver/dist/session-uL1ytjek.d.ts:781

Milliseconds since session start, on the same clock as every other event.

For a file this is when the driver *read* the line, not when the program
wrote it: the two differ by up to one poll interval, so treat it as an
upper bound rather than as the write timestamp. A record carries the
adapter's own timestamp inside it.

#### Inherited from

`AppLogEvent.timeMs`
