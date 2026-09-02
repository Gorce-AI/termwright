---
title: "Interface: ActionabilityExplanation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionabilityExplanation

# Interface: ActionabilityExplanation

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:218

## Properties

### actionable

> `readonly` **actionable**: `boolean`

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:219

***

### checkpoint

> `readonly` **checkpoint**: [`ObservationStamp`](../observationstamp/)

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:221

***

### intent

> `readonly` **intent**: [`ActionIntent`](../actionintent/)

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:220

***

### reason?

> `readonly` `optional` **reason?**: `object`

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:224

#### code

> `readonly` **code**: `string`

#### message

> `readonly` **message**: `string`

#### targetRef?

> `readonly` `optional` **targetRef?**: [`LocatorRef`](../../type-aliases/locatorref/)

***

### requirements

> `readonly` **requirements**: readonly [`ConditionResult`](../conditionresult/)[]

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:222

***

### strategy?

> `readonly` `optional` **strategy?**: `string`

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:223
