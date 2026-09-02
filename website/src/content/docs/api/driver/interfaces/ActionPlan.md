---
title: "Interface: ActionPlan"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionPlan

# Interface: ActionPlan

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:207

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:208

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:211

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:209

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:210

***

### operations

> `readonly` **operations**: readonly [`RecordedDeviceOperation`](../../type-aliases/recordeddeviceoperation/)[]

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:215

***

### physicalRegion?

> `readonly` `optional` **physicalRegion?**: [`PhysicalRegion`](../physicalregion/)

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:214

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:212

***

### strategy

> `readonly` **strategy**: `string`

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:213

***

### valuePolicy

> `readonly` **valuePolicy**: `"raw"` \| `"none"` \| `"redacted"`

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:216
