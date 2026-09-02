---
title: "Type Alias: ExecutableDeviceOperation"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / ExecutableDeviceOperation

# Type Alias: ExecutableDeviceOperation

> **ExecutableDeviceOperation** = \{ `device`: `"keyboard"`; `kind`: `"press"` \| `"type"` \| `"paste"`; `value`: [`ExecutableValue`](../executablevalue/); \} \| \{ `button?`: `"left"` \| `"middle"` \| `"right"`; `column`: `number`; `deltaX?`: `number`; `deltaY?`: `number`; `device`: `"mouse"`; `kind`: `"move"` \| `"down"` \| `"up"` \| `"wheel"`; `modifiers?`: readonly (`"shift"` \| `"alt"` \| `"control"`)[]; `row`: `number`; \}

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:175
