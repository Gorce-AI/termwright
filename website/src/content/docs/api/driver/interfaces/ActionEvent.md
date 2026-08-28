---
title: "Interface: ActionEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionEvent

# Interface: ActionEvent

Defined in: [driver/src/api.ts:982](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L982)

One action the harness or a locator performed, reported after it finished —
successfully or not.

This is what turns a recording into a story: the raw stream shows bytes going
into the terminal, while these events say which call sent them, at what, and
whether it worked.

## Properties

### actionability?

> `readonly` `optional` **actionability?**: [`ActionabilityExplanation`](../actionabilityexplanation/)

Defined in: [driver/src/api.ts:999](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L999)

Exact failed planner evaluation, bound to the checkpoint that rejected the action.

***

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:984](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L984)

Correlates this completion with the preceding [ActionStartedEvent](../actionstartedevent/).

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:986](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L986)

Method that ran, e.g. `'click'`, `'press'`, `'resize'`.

***

### error?

> `readonly` `optional` **error?**: `string`

Defined in: [driver/src/api.ts:997](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L997)

Failure reason: the [TermwrightErrorCode](../../type-aliases/termwrighterrorcode/) when the action failed with
a driver error, otherwise the error's name. Never the full message — the
message belongs to the thrown error, this field is for grouping.

***

### observation?

> `readonly` `optional` **observation?**: [`ObservationStamp`](../observationstamp/)

Defined in: [driver/src/api.ts:1001](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1001)

Atomic screen/tree identity at completion; trace consumers must not guess.

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [driver/src/api.ts:991](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L991)

***

### receipt?

> `readonly` `optional` **receipt?**: [`ActionReceipt`](../actionreceipt/)

Defined in: [driver/src/api.ts:1007](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1007)

The exact plan and physical operations executed for a successful semantic
action. This is the same receipt returned to the caller, not a diagnostic
reconstruction performed after the action.

***

### ref?

> `readonly` `optional` **ref?**: [`LocatorRef`](../../type-aliases/locatorref/)

Defined in: [driver/src/api.ts:990](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L990)

Ref of the target the action resolved, when it resolved one.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:988](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L988)

The locator's description, for actions that had one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1008](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1008)
