---
title: "Interface: TermwrightTestResources"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightTestResources

# Interface: TermwrightTestResources

Defined in: [test/src/provider.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L17)

Resources atomically admitted before Vitest starts the authored try.

## Properties

### terminals?

> `readonly` `optional` **terminals?**: `number`

Defined in: [test/src/provider.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L19)

Maximum simultaneously live terminal sessions in this Attempt.

***

### traceWriters?

> `readonly` `optional` **traceWriters?**: `number`

Defined in: [test/src/provider.ts:21](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L21)

Maximum simultaneously live retained trace writers in this Attempt.
