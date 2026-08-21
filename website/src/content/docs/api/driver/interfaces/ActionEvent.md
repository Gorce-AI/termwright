---
title: "Interface: ActionEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionEvent

# Interface: ActionEvent

Defined in: [api.ts:680](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L680)

One action the harness or a locator performed, reported after it finished —
successfully or not.

This is what turns a recording into a story: the raw stream shows bytes going
into the terminal, while these events say which call sent them, at what, and
whether it worked.

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: [api.ts:682](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L682)

Correlates this completion with the preceding [ActionStartedEvent](../actionstartedevent/).

***

### api

> `readonly` **api**: `string`

Defined in: [api.ts:684](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L684)

Method that ran, e.g. `'click'`, `'press'`, `'resize'`.

***

### error?

> `readonly` `optional` **error?**: `string`

Defined in: [api.ts:695](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L695)

Failure reason: the [TermwrightErrorCode](../../type-aliases/termwrighterrorcode/) when the action failed with
a driver error, otherwise the error's name. Never the full message — the
message belongs to the thrown error, this field is for grouping.

***

### observation?

> `readonly` `optional` **observation?**: `ObservationStamp`

Defined in: [api.ts:697](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L697)

Atomic screen/tree identity at completion; trace consumers must not guess.

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [api.ts:689](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L689)

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [api.ts:688](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L688)

Ref of the target the action resolved, when it resolved one.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [api.ts:686](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L686)

The locator's description, for actions that had one.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [api.ts:698](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L698)
