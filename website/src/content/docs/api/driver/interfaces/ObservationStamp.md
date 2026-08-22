---
title: "Interface: ObservationStamp"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ObservationStamp

# Interface: ObservationStamp

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:600

Atomic identity of the screen/tree pair used for an observation.

## Properties

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:602

***

### epoch

> `readonly` **epoch**: `number`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:603

***

### pairedScreenRevision

> `readonly` **pairedScreenRevision**: `number` \| `null`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:609

Screen revision paired to semanticRevision, or null when no pair exists.

***

### screenRevision

> `readonly` **screenRevision**: `number`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:606

***

### semanticRevision

> `readonly` **semanticRevision**: `number` \| `null`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:607

***

### sequence

> `readonly` **sequence**: `number`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:605

Monotonic publication order across both screen and semantic revisions.

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:601
