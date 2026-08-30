---
title: "Interface: AppLogEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / AppLogEvent

# Interface: AppLogEvent

Defined in: [driver/src/api.ts:913](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L913)

One entry of an application's own log, published on the session timeline.

Two sources feed this event and they carry different payloads: a followed
file yields [line](#line), an instrumented adapter yields a structured
[record](#record). Exactly one of them is present.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [driver/src/api.ts:915](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L915)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [driver/src/api.ts:922](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L922)

Raw line, for a followed file. Truncated lines end with an ellipsis.

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: [driver/src/api.ts:920](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L920)

Path of the followed file, for `source: 'file'`. A label can be short and
shared between sources; the path is what a reader opens.

***

### record?

> `readonly` `optional` **record?**: `LogRecord`

Defined in: [driver/src/api.ts:924](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L924)

Structured record, for an adapter that negotiated the logs capability.

***

### source

> `readonly` **source**: `"file"` \| `"adapter"`

Defined in: [driver/src/api.ts:914](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L914)

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:933](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L933)

Milliseconds since session start, on the same clock as every other event.

For a file this is when the driver *read* the line, not when the program
wrote it: the two differ by up to one poll interval, so treat it as an
upper bound rather than as the write timestamp. A record carries the
adapter's own timestamp inside it.
