---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:741](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L741)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:744](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L744)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:743](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L743)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:749](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L749)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:742](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L742)
