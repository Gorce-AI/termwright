---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:969](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L969)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:972](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L972)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:971](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L971)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:977](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L977)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:970](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L970)
