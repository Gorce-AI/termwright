---
title: "Interface: ActionEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionEvent

# Interface: ActionEvent

Defined in: [driver/src/api.ts:986](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L986)

One action the harness or a locator performed, reported after it finished —
successfully or not.

This is what turns a recording into a story: the raw stream shows bytes going
into the terminal, while these events say which call sent them, at what, and
whether it worked.

## Properties

### actionability?

> `readonly` `optional` **actionability?**: [`ActionabilityExplanation`](../actionabilityexplanation/)

Defined in: [driver/src/api.ts:1003](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1003)

Exact failed planner evaluation, bound to the checkpoint that rejected the action.

***

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:988](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L988)

Correlates this completion with the preceding [ActionStartedEvent](../actionstartedevent/).

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:990](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L990)

Method that ran, e.g. `'click'`, `'press'`, `'resize'`.

***

### error?

> `readonly` `optional` **error?**: `string`

Defined in: [driver/src/api.ts:1001](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1001)

Failure reason: the [TermwrightErrorCode](../../type-aliases/termwrighterrorcode/) when the action failed with
a driver error, otherwise the error's name. Never the full message — the
message belongs to the thrown error, this field is for grouping.

***

### observation?

> `readonly` `optional` **observation?**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:1005](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1005)

Atomic screen/tree identity at completion; trace consumers must not guess.

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [driver/src/api.ts:995](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L995)

***

### receipt?

> `readonly` `optional` **receipt?**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:1011](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1011)

The exact plan and physical operations executed for a successful semantic
action. This is the same receipt returned to the caller, not a diagnostic
reconstruction performed after the action.

***

### ref?

> `readonly` `optional` **ref?**: [`LocatorRef`](../../type-aliases/locatorref/)

Defined in: [driver/src/api.ts:994](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L994)

Ref of the target the action resolved, when it resolved one.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:992](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L992)

The locator's description, for actions that had one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1012](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1012)
