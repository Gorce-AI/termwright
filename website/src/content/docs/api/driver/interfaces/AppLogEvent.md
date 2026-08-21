---
title: "Interface: AppLogEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / AppLogEvent

# Interface: AppLogEvent

Defined in: [driver/src/api.ts:712](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L712)

One entry of an application's own log, published on the session timeline.

Two sources feed this event and they carry different payloads: a followed
file yields [line](#line), an instrumented adapter yields a structured
[record](#record). Exactly one of them is present.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [driver/src/api.ts:714](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L714)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [driver/src/api.ts:721](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L721)

Raw line, for a followed file. Truncated lines end with an ellipsis.

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: [driver/src/api.ts:719](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L719)

Path of the followed file, for `source: 'file'`. A label can be short and
shared between sources; the path is what a reader opens.

***

### record?

> `readonly` `optional` **record?**: `LogRecord`

Defined in: [driver/src/api.ts:723](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L723)

Structured record, for an adapter that negotiated the logs capability.

***

### source

> `readonly` **source**: `"file"` \| `"adapter"`

Defined in: [driver/src/api.ts:713](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L713)

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:732](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L732)

Milliseconds since session start, on the same clock as every other event.

For a file this is when the driver *read* the line, not when the program
wrote it: the two differ by up to one poll interval, so treat it as an
upper bound rather than as the write timestamp. A record carries the
adapter's own timestamp inside it.
