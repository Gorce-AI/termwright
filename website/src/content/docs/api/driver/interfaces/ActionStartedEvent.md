---
title: "Interface: ActionStartedEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionStartedEvent

# Interface: ActionStartedEvent

Defined in: [driver/src/api.ts:1016](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1016)

An action that has begun but has not settled yet.

Consumers use this lifecycle edge for an honest live progress indicator.
The eventual [ActionEvent](../actionevent/) with the same `actionId` remains the
authoritative outcome.

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:1017](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1017)

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:1019](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1019)

Method that began, e.g. `'click'`, `'press'`, `'resize'`.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:1021](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1021)

Locator description when the action was initiated through a locator.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1022](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1022)
