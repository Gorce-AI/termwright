---
title: "Interface: ObservationStamp"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ObservationStamp

# Interface: ObservationStamp

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:494

Atomic identity of the screen/tree pair used for an observation.

## Properties

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:496

***

### epoch

> `readonly` **epoch**: `number`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:497

***

### pairedScreenRevision

> `readonly` **pairedScreenRevision**: `number` \| `null`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:503

Screen revision paired to semanticRevision, or null when no pair exists.

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:500

***

### semanticRevision

> `readonly` **semanticRevision**: `number` \| `null`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:501

***

### sequence

> `readonly` **sequence**: `number`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:499

Monotonic publication order across both screen and semantic revisions.

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:495
