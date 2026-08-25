---
title: "Interface: ActionPlan"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionPlan

# Interface: ActionPlan

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:830

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:831

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:834

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:832

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:833

***

### operations

> `readonly` **operations**: readonly [`RecordedDeviceOperation`](../../type-aliases/recordeddeviceoperation/)[]

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:838

***

### physicalRegion?

> `readonly` `optional` **physicalRegion?**: [`PhysicalRegion`](../physicalregion/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:837

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:835

***

### strategy

> `readonly` **strategy**: `string`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:836

***

### valuePolicy

> `readonly` **valuePolicy**: `"raw"` \| `"none"` \| `"redacted"`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:839
