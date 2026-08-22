---
title: "Interface: ActionReceipt"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionReceipt

# Interface: ActionReceipt

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:853

## Properties

### after

> `readonly` **after**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:857

***

### before

> `readonly` **before**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:856

***

### executed

> `readonly` **executed**: readonly [`RecordedDeviceOperation`](../../type-aliases/recordeddeviceoperation/)[]

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:858

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:854

***

### outcome

> `readonly` **outcome**: `"completed"` \| `"partial"` \| `"failed"`

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:859

***

### plan

> `readonly` **plan**: [`ActionPlan`](../actionplan/)

Defined in: protocol/dist/action-model-8X-3ivpw.d.ts:855
