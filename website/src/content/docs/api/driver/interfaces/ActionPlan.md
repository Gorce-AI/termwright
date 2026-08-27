---
title: "Interface: ActionPlan"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionPlan

# Interface: ActionPlan

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:184

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:185

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:188

***

### contractId

> `readonly` **contractId**: `string`

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:186

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:187

***

### operations

> `readonly` **operations**: readonly [`RecordedDeviceOperation`](../../type-aliases/recordeddeviceoperation/)[]

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:192

***

### physicalRegion?

> `readonly` `optional` **physicalRegion?**: [`PhysicalRegion`](../physicalregion/)

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:191

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:189

***

### strategy

> `readonly` **strategy**: `string`

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:190

***

### valuePolicy

> `readonly` **valuePolicy**: `"raw"` \| `"none"` \| `"redacted"`

Defined in: protocol/dist/action-model-BP9Znu6L.d.ts:193
