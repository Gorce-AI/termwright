---
title: "Interface: TermwrightTestResources"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / TermwrightTestResources

# Interface: TermwrightTestResources

Defined in: resource-broker/dist/vitest.d.ts:6

## Properties

### nativeHost?

> `readonly` `optional` **nativeHost?**: `"shared"` \| `"exclusive"`

Defined in: resource-broker/dist/vitest.d.ts:12

Makes native transport pressure exclusive while preserving the true terminal count.

***

### terminals?

> `readonly` `optional` **terminals?**: `number`

Defined in: resource-broker/dist/vitest.d.ts:8

Maximum simultaneously live terminal sessions in this Attempt.

***

### traceWriters?

> `readonly` `optional` **traceWriters?**: `number`

Defined in: resource-broker/dist/vitest.d.ts:10

Maximum simultaneously live retained trace writers in this Attempt.
