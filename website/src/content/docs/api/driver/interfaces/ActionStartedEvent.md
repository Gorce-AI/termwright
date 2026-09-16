---
title: "Interface: ActionStartedEvent"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ActionStartedEvent

# Interface: ActionStartedEvent

Defined in: [driver/src/api.ts:1097](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1097)

An action that has begun but has not settled yet.

Consumers use this lifecycle edge for an honest live progress indicator.
The eventual [ActionEvent](../actionevent/) with the same `actionId` remains the
authoritative outcome.

## Properties

### actionId

> `readonly` **actionId**: `string`

Defined in: [driver/src/api.ts:1098](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1098)

***

### api

> `readonly` **api**: `string`

Defined in: [driver/src/api.ts:1100](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1100)

Method that began, e.g. `'click'`, `'press'`, `'resize'`.

***

### selector?

> `readonly` `optional` **selector?**: `string`

Defined in: [driver/src/api.ts:1102](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1102)

Locator description when the action was initiated through a locator.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1103](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1103)
