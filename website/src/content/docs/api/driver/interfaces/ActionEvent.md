---
title: "Interface: ActionEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionEvent

# Interface: ActionEvent

Defined in: [driver/src/api.ts:1013](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1013)

One action the harness or a locator performed, reported after it finished —
successfully or not.

This is what turns a recording into a story: the raw stream shows bytes going
into the terminal, while these events say which call sent them, at what, and
whether it worked.

## Properties

### actionability?

> `readonly` `optional` **actionability?**: [`ActionabilityExplanation`](../actionabilityexplanation/)

Defined in: [driver/src/api.ts:1030](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1030)

Exact failed planner evaluation, bound to the checkpoint that rejected the action.

***

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:1015](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1015)

Correlates this completion with the preceding [ActionStartedEvent](../actionstartedevent/).

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:1017](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1017)

Method that ran, e.g. `'click'`, `'press'`, `'resize'`.

***

### error?

> `readonly` `optional` **error?**: `string`

Defined in: [driver/src/api.ts:1028](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1028)

Failure reason: the [TermwrightErrorCode](../../type-aliases/termwrighterrorcode/) when the action failed with
a driver error, otherwise the error's name. Never the full message — the
message belongs to the thrown error, this field is for grouping.

***

### observation?

> `readonly` `optional` **observation?**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:1032](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1032)

Atomic screen/tree identity at completion; trace consumers must not guess.

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [driver/src/api.ts:1022](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1022)

***

### receipt?

> `readonly` `optional` **receipt?**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:1038](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1038)

The exact plan and physical operations executed for a successful semantic
action. This is the same receipt returned to the caller, not a diagnostic
reconstruction performed after the action.

***

### ref?

> `readonly` `optional` **ref?**: [`LocatorRef`](../../type-aliases/locatorref/)

Defined in: [driver/src/api.ts:1021](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1021)

Ref of the target the action resolved, when it resolved one.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:1019](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1019)

The locator's description, for actions that had one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1039](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1039)
