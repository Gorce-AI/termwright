---
title: "Interface: ActionabilityExplanation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionabilityExplanation

# Interface: ActionabilityExplanation

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:671

## Properties

### actionable

> `readonly` **actionable**: `boolean`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:672

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:674

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:673

***

### reason?

> `readonly` `optional` **reason?**: `object`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:677

#### code

> `readonly` **code**: `string`

#### message

> `readonly` **message**: `string`

#### targetRef?

> `readonly` `optional` **targetRef?**: `string`

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:675

***

### strategy?

> `readonly` `optional` **strategy?**: `string`

Defined in: protocol/dist/action-model-ClhrNC39.d.ts:676
