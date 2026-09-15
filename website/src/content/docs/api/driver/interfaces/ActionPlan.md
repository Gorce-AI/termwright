---
title: "Interface: ActionPlan"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionPlan

# Interface: ActionPlan

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:209

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:210

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:213

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:211

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:212

***

### operations

> `readonly` **operations**: readonly [`RecordedDeviceOperation`](../../type-aliases/recordeddeviceoperation/)[]

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:217

***

### physicalRegion?

> `readonly` `optional` **physicalRegion?**: [`PhysicalRegion`](../physicalregion/)

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:216

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:214

***

### strategy

> `readonly` **strategy**: `string`

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:215

***

### valuePolicy

> `readonly` **valuePolicy**: `"raw"` \| `"none"` \| `"redacted"`

Defined in: protocol/dist/action-model-hL2zNsq0.d.ts:218
