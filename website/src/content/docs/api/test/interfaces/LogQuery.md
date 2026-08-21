---
title: "Interface: LogQuery"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / LogQuery

# Interface: LogQuery

Defined in: [test/src/logs.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L20)

Which entries an operation applies to. Every field narrows further.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [test/src/logs.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L26)

***

### level?

> `readonly` `optional` **level?**: `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"` \| readonly (`"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`)[]

Defined in: [test/src/logs.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L22)

One level or a set of them.

***

### logger?

> `readonly` `optional` **logger?**: `string`

Defined in: [test/src/logs.ts:27](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L27)

***

### message?

> `readonly` `optional` **message?**: `string` \| `RegExp`

Defined in: [test/src/logs.ts:29](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L29)

Substring, or a pattern, of the message (or of a file line).

***

### minLevel?

> `readonly` `optional` **minLevel?**: `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Defined in: [test/src/logs.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L24)

This level or more severe.

***

### sessionId?

> `readonly` `optional` **sessionId?**: `string`

Defined in: [test/src/logs.ts:30](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L30)

***

### source?

> `readonly` `optional` **source?**: `"file"` \| `"adapter"`

Defined in: [test/src/logs.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/logs.ts#L25)
