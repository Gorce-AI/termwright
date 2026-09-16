---
title: "Interface: ActionPlan"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionPlan

# Interface: ActionPlan

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:213

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:214

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:217

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:215

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:216

***

### operations

> `readonly` **operations**: readonly [`RecordedDeviceOperation`](../../type-aliases/recordeddeviceoperation/)[]

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:221

***

### physicalRegion?

> `readonly` `optional` **physicalRegion?**: [`PhysicalRegion`](../physicalregion/)

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:220

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:218

***

### strategy

> `readonly` **strategy**: `string`

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:219

***

### valuePolicy

> `readonly` **valuePolicy**: `"raw"` \| `"none"` \| `"redacted"`

Defined in: protocol/dist/action-model-D8xraJAt.d.ts:222
