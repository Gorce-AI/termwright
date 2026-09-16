---
title: "Interface: AbortableWaitOptions"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / AbortableWaitOptions

# Interface: AbortableWaitOptions

Defined in: [driver/src/api.ts:602](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L602)

Options for event-driven waits that can be detached by a transport.

## Extends

- [`WaitOptions`](../waitoptions/)

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [driver/src/api.ts:604](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L604)

Cancels this wait without closing the terminal or consuming a later revision.

***

### timeout?

> `readonly` `optional` **timeout?**: `number`

Defined in: [driver/src/api.ts:598](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L598)

#### Inherited from

[`WaitOptions`](../waitoptions/).[`timeout`](../waitoptions/#timeout)
