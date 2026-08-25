---
title: "Interface: TermwrightTestResources"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightTestResources

# Interface: TermwrightTestResources

Defined in: [test/src/provider.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L20)

Resources atomically admitted before Vitest starts the authored try.

## Properties

### terminals?

> `readonly` `optional` **terminals?**: `number`

Defined in: [test/src/provider.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L22)

Maximum simultaneously live terminal sessions in this Attempt.

***

### traceWriters?

> `readonly` `optional` **traceWriters?**: `number`

Defined in: [test/src/provider.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L24)

Maximum simultaneously live retained trace writers in this Attempt.
