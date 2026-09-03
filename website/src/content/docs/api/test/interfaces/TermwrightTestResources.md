---
title: "Interface: TermwrightTestResources"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightTestResources

# Interface: TermwrightTestResources

Defined in: [test/src/provider.ts:8](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L8)

## Properties

### hostPressure?

> `readonly` `optional` **hostPressure?**: `"exclusive"`

Defined in: [test/src/provider.ts:16](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L16)

Exclusively reserves host-wide CPU, memory, I/O and process/toolchain pressure.

***

### load?

> `readonly` `optional` **load?**: `"exclusive"` \| `"light"` \| `"normal"` \| `"heavy"`

Defined in: [test/src/provider.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L18)

Coarse host CPU/memory/I/O admission cost; defaults to `normal`.

***

### nativeHost?

> `readonly` `optional` **nativeHost?**: `"shared"` \| `"exclusive"`

Defined in: [test/src/provider.ts:14](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L14)

Makes native transport pressure exclusive while preserving the true terminal count.

***

### terminals?

> `readonly` `optional` **terminals?**: `number`

Defined in: [test/src/provider.ts:10](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L10)

Maximum simultaneously live terminal sessions in this Attempt.

***

### traceWriters?

> `readonly` `optional` **traceWriters?**: `number`

Defined in: [test/src/provider.ts:12](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/provider.ts#L12)

Maximum simultaneously live retained trace writers in this Attempt.
