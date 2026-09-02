---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:941](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L941)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:944](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L944)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:943](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L943)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:949](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L949)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:942](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L942)
