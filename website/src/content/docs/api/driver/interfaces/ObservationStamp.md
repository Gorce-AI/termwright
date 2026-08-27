---
title: "Interface: ObservationStamp"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ObservationStamp

# Interface: ObservationStamp

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:88

Atomic identity of the screen/tree pair used for an observation.

## Properties

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:90

***

### epoch

> `readonly` **epoch**: `number`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:91

***

### pairedScreenRevision

> `readonly` **pairedScreenRevision**: `number` \| `null`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:97

Screen revision paired to semanticRevision, or null when no pair exists.

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:94

***

### semanticRevision

> `readonly` **semanticRevision**: `number` \| `null`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:95

***

### sequence

> `readonly` **sequence**: `number`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:93

Monotonic publication order across both screen and semantic revisions.

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: protocol/dist/contract-CH9gmj2Y.d.ts:89
