---
title: "Interface: ActionStartedEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionStartedEvent

# Interface: ActionStartedEvent

Defined in: [driver/src/api.ts:1050](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1050)

An action that has begun but has not settled yet.

Consumers use this lifecycle edge for an honest live progress indicator.
The eventual [ActionEvent](../actionevent/) with the same `actionId` remains the
authoritative outcome.

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:1051](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1051)

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:1053](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1053)

Method that began, e.g. `'click'`, `'press'`, `'resize'`.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:1055](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1055)

Locator description when the action was initiated through a locator.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1056](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1056)
