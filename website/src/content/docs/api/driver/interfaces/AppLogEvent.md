---
title: "Interface: AppLogEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / AppLogEvent

# Interface: AppLogEvent

Defined in: [driver/src/api.ts:941](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L941)

One entry of an application's own log, published on the session timeline.

Two sources feed this event and they carry different payloads: a followed
file yields [line](#line), an instrumented adapter yields a structured
[record](#record). Exactly one of them is present.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [driver/src/api.ts:943](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L943)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [driver/src/api.ts:950](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L950)

Raw line, for a followed file. Truncated lines end with an ellipsis.

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: [driver/src/api.ts:948](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L948)

Path of the followed file, for `source: 'file'`. A label can be short and
shared between sources; the path is what a reader opens.

***

### record?

> `readonly` `optional` **record?**: `LogRecord`

Defined in: [driver/src/api.ts:952](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L952)

Structured record, for an adapter that negotiated the logs capability.

***

### source

> `readonly` **source**: `"file"` \| `"adapter"`

Defined in: [driver/src/api.ts:942](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L942)

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:961](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L961)

Milliseconds since session start, on the same clock as every other event.

For a file this is when the driver *read* the line, not when the program
wrote it: the two differ by up to one poll interval, so treat it as an
upper bound rather than as the write timestamp. A record carries the
adapter's own timestamp inside it.
