---
title: "Interface: AppLogEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / AppLogEvent

# Interface: AppLogEvent

Defined in: [driver/src/api.ts:924](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L924)

One entry of an application's own log, published on the session timeline.

Two sources feed this event and they carry different payloads: a followed
file yields [line](#line), an instrumented adapter yields a structured
[record](#record). Exactly one of them is present.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [driver/src/api.ts:926](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L926)

***

### line?

> `readonly` `optional` **line?**: `string`

Defined in: [driver/src/api.ts:933](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L933)

Raw line, for a followed file. Truncated lines end with an ellipsis.

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: [driver/src/api.ts:931](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L931)

Path of the followed file, for `source: 'file'`. A label can be short and
shared between sources; the path is what a reader opens.

***

### record?

> `readonly` `optional` **record?**: `LogRecord`

Defined in: [driver/src/api.ts:935](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L935)

Structured record, for an adapter that negotiated the logs capability.

***

### source

> `readonly` **source**: `"file"` \| `"adapter"`

Defined in: [driver/src/api.ts:925](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L925)

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:944](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L944)

Milliseconds since session start, on the same clock as every other event.

For a file this is when the driver *read* the line, not when the program
wrote it: the two differ by up to one poll interval, so treat it as an
upper bound rather than as the write timestamp. A record carries the
adapter's own timestamp inside it.
