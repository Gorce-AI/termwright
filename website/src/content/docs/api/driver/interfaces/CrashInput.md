---
title: "Interface: CrashInput"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / CrashInput

# Interface: CrashInput

Defined in: [driver/src/api.ts:1008](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1008)

One remembered input, as it appears in a [CrashReport](../crashreport/).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [driver/src/api.ts:1011](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1011)

***

### kind

> `readonly` **kind**: `"key"` \| `"mouse"` \| `"paste"` \| `"raw"`

Defined in: [driver/src/api.ts:1010](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1010)

***

### preview?

> `readonly` `optional` **preview?**: `string`

Defined in: [driver/src/api.ts:1016](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1016)

Escaped, truncated preview of what was sent. Omitted for pastes, which
routinely carry secrets — their size is reported instead.

***

### timeMs

> `readonly` **timeMs**: `number`

Defined in: [driver/src/api.ts:1009](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1009)
