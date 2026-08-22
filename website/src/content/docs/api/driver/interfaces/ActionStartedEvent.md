---
title: "Interface: ActionStartedEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionStartedEvent

# Interface: ActionStartedEvent

Defined in: [driver/src/api.ts:1031](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1031)

An action that has begun but has not settled yet.

Consumers use this lifecycle edge for an honest live progress indicator.
The eventual [ActionEvent](../actionevent/) with the same `actionId` remains the
authoritative outcome.

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:1032](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1032)

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:1034](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1034)

Method that began, e.g. `'click'`, `'press'`, `'resize'`.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:1036](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1036)

Locator description when the action was initiated through a locator.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1037](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1037)
