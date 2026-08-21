---
title: "Interface: ActionStartedEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionStartedEvent

# Interface: ActionStartedEvent

Defined in: [api.ts:708](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L708)

An action that has begun but has not settled yet.

Consumers use this lifecycle edge for an honest live progress indicator.
The eventual [ActionEvent](../actionevent/) with the same `actionId` remains the
authoritative outcome.

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: [api.ts:709](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L709)

***

### api

> `readonly` **api**: `string`

Defined in: [api.ts:711](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L711)

Method that began, e.g. `'click'`, `'press'`, `'resize'`.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [api.ts:713](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L713)

Locator description when the action was initiated through a locator.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [api.ts:714](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L714)
