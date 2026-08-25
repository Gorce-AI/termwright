---
title: "Interface: ActionEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionEvent

# Interface: ActionEvent

Defined in: [driver/src/api.ts:1014](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1014)

One action the harness or a locator performed, reported after it finished —
successfully or not.

This is what turns a recording into a story: the raw stream shows bytes going
into the terminal, while these events say which call sent them, at what, and
whether it worked.

## Properties

### actionability?

> `readonly` `optional` **actionability?**: [`ActionabilityExplanation`](../actionabilityexplanation/)

Defined in: [driver/src/api.ts:1031](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1031)

Exact failed planner evaluation, bound to the checkpoint that rejected the action.

***

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:1016](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1016)

Correlates this completion with the preceding [ActionStartedEvent](../actionstartedevent/).

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:1018](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1018)

Method that ran, e.g. `'click'`, `'press'`, `'resize'`.

***

### error?

> `readonly` `optional` **error?**: `string`

Defined in: [driver/src/api.ts:1029](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1029)

Failure reason: the [TermwrightErrorCode](../../type-aliases/termwrighterrorcode/) when the action failed with
a driver error, otherwise the error's name. Never the full message — the
message belongs to the thrown error, this field is for grouping.

***

### observation?

> `readonly` `optional` **observation?**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:1033](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1033)

Atomic screen/tree identity at completion; trace consumers must not guess.

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [driver/src/api.ts:1023](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1023)

***

### receipt?

> `readonly` `optional` **receipt?**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:1039](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1039)

The exact plan and physical operations executed for a successful semantic
action. This is the same receipt returned to the caller, not a diagnostic
reconstruction performed after the action.

***

### ref?

> `readonly` `optional` **ref?**: [`LocatorRef`](../../type-aliases/locatorref/)

Defined in: [driver/src/api.ts:1022](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1022)

Ref of the target the action resolved, when it resolved one.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:1020](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1020)

The locator's description, for actions that had one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1040](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1040)
